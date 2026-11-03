/**
 * Notas de entrega: cada execução termina dizendo o que mudou, por quê, como testar e o que ficou de risco
 * (report_delivery pelo MCP). A Central completa com o diff e o PR; sem nota, registra o resultado e marca "sem explicação".
 * Quem mexeu em código entra na fila de revisão; o resto é informativo. O digest junta tudo desde a última visita.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { DeliveryDto, DigestDto } from '../src/app/shared/contract';
import { all, get, now, run } from './db';

const execFileP = promisify(execFile);

const SELECT = `select d.*, a.name agent_name, p.name project_name from deliveries d
  left join agents a on a.id = d.agent_id left join projects p on p.slug = d.project_slug`;

const fromRow = (r: any): DeliveryDto => ({ ...r, explained: !!r.explained });

export const listDeliveries = (since: string | null, status: string | null) =>
  all<any>(`${SELECT} where (? is null or d.created_at > ?) and (? is null or d.status = ?) order by d.id desc limit 200`, since, since, status, status).map(fromRow);

/** O agente conta a entrega (pode chamar mais de uma vez: a última vale). */
export function reportDelivery(runId: number, i: { title: string; what: string; why?: string; how_to_test?: string; risks?: string }): void {
  const r = get<{ project_slug: string | null; agent_id: number | null; task_id: number | null }>('select project_slug, agent_id, task_id from runs where id = ?', runId);
  if (!r) throw new Error('Execução não encontrada.');
  const cur = get<{ id: number }>('select id from deliveries where run_id = ?', runId);
  const fields = [i.title.trim().slice(0, 160), i.what.trim().slice(0, 2000), i.why?.trim() || null, i.how_to_test?.trim() || null, i.risks?.trim() || null];
  if (cur) run('update deliveries set title = ?, what = ?, why = ?, how_to_test = ?, risks = ?, explained = 1 where id = ?', ...fields, cur.id);
  else run(`insert into deliveries (run_id, project_slug, agent_id, task_id, title, what, why, how_to_test, risks, explained, status)
    values (?,?,?,?,?,?,?,?,?,1,'pending')`, runId, r.project_slug, r.agent_id, r.task_id, ...fields);
}

/** Fim da execução: garante a nota, mede o diff e decide se vai para revisão. */
export async function closeDelivery(runId: number): Promise<void> {
  const r = get<{ prompt: string; status: string; result: string | null; pr_url: string | null; worktree_path: string | null; base_branch: string | null;
    project_slug: string | null; agent_id: number | null; task_id: number | null }>(
    'select prompt, status, result, pr_url, worktree_path, base_branch, project_slug, agent_id, task_id from runs where id = ?', runId);
  if (!r || r.status === 'killed') return;
  if (!get('select 1 from deliveries where run_id = ?', runId)) {
    const title = r.prompt.includes('[gestor:planejar]') ? 'Gestor organizou o backlog' : r.prompt.split('\n')[0].slice(0, 160);
    run(`insert into deliveries (run_id, project_slug, agent_id, task_id, title, what, explained, status) values (?,?,?,?,?,?,0,'pending')`,
      runId, r.project_slug, r.agent_id, r.task_id, title, (r.result ?? 'Terminou sem resultado.').slice(0, 2000));
  }
  let files = 0, additions = 0, deletions = 0, stat: string | null = null;
  if (r.worktree_path && r.base_branch) {
    try {
      const base = (await execFileP('git', ['-C', r.worktree_path, 'merge-base', 'HEAD', r.base_branch], { windowsHide: true })).stdout.trim();
      const short = (await execFileP('git', ['-C', r.worktree_path, 'diff', '--shortstat', base, 'HEAD'], { windowsHide: true })).stdout;
      files = Number(/(\d+) files? changed/.exec(short)?.[1] ?? 0);
      additions = Number(/(\d+) insertions?/.exec(short)?.[1] ?? 0);
      deletions = Number(/(\d+) deletions?/.exec(short)?.[1] ?? 0);
      stat = (await execFileP('git', ['-C', r.worktree_path, 'diff', '--stat=100', base, 'HEAD'], { windowsHide: true })).stdout.trim().slice(-3000) || null;
    } catch { /* worktree já removido ou sem a base: fica sem diff */ }
  }
  const code = files > 0 || !!r.pr_url;
  const waiting = !!get<{ w: string | null }>('select waiting w from runs where id = ?', runId)?.w;
  run(`update deliveries set outcome = ?, pr_url = ?, files = ?, additions = ?, deletions = ?, diff_stat = ?,
       status = case when status = 'pending' then ? else status end where run_id = ?`,
    r.status, r.pr_url, files, additions, deletions, stat, waiting ? 'paused' : code ? 'review' : 'info', runId);
}

/** Ajuste terminou: volta para a revisão e mede o diff de novo. */
export async function reopenDelivery(runId: number): Promise<void> {
  if (!run(`update deliveries set status = 'pending' where run_id = ? and status in ('adjusting', 'paused')`, runId).changes) return;
  await closeDelivery(runId);
  // retomada de uma espera: a tarefa que ficou em "fazendo" segue o caminho normal
  const t = get<{ task_id: number | null; status: string }>('select d.task_id, r.status from deliveries d join runs r on r.id = d.run_id where d.run_id = ?', runId);
  if (t?.task_id && !get<{ w: string | null }>('select waiting w from runs where id = ?', runId)?.w) {
    run(`update tasks set "column" = ?, updated_at = ? where id = ? and "column" = 'doing'`, t.status === 'failed' ? 'todo' : 'review', now(), t.task_id);
  }
}

/** Revisão do Gustavo: aceitar (tarefa vai para Feito), pedir ajuste (com o texto) ou descartar. */
export function reviewDelivery(id: number, action: 'accepted' | 'adjusting' | 'discarded', note: string | null): void {
  const d = get<{ task_id: number | null }>('select task_id from deliveries where id = ?', id);
  if (!d) throw new Error('Entrega não encontrada.');
  run('update deliveries set status = ?, review_note = ?, reviewed_at = ? where id = ?', action, note?.trim() || null, now(), id);
  if (action === 'accepted' && d.task_id) {
    const prodWithPr = get('select 1 from tasks t join projects p on p.slug = t.project_slug where t.id = ? and p.done_when = ? and t.pr_url is not null', d.task_id, 'prod');
    if (!prodWithPr) run(`update tasks set "column" = 'done', updated_at = ? where id = ? and "column" <> 'done'`, now(), d.task_id);
  }
}

/** Tudo o que aconteceu desde `since`, para o "Enquanto você estava fora". */
export function digest(since: string): DigestDto {
  const n = (sql: string, ...a: string[]) => get<{ n: number }>(sql, ...a)?.n ?? 0;
  const runs = get<{ n: number; minutes: number | null; cost: number | null }>(`select count(*) n,
      sum((julianday(finished_at) - julianday(started_at)) * 1440) minutes, sum(cost_usd) cost
    from runs where finished_at > ? and status <> 'killed'`, since)!;
  return {
    since,
    deliveries: listDeliveries(since, null),
    tasks_done: all(`select id, title, project_slug from tasks where "column" = 'done' and updated_at > ? order by updated_at desc limit 50`, since),
    roadmap: all(`select e.kind, e.title, e.detail, e.author, e.at, e.project_slug from milestone_events e where e.at > ? order by e.id desc limit 50`, since),
    ideas: n(`select count(*) n from ideas where created_at > ? and status = 'new'`, since),
    decisions: n(`select count(*) n from proposals where created_at > ? and status = 'proposed'`, since),
    memories: n(`select count(*) n from memories where created_at > ? and author <> 'gustavo' and status = 'active'`, since),
    runs: runs.n, minutes: Math.round(runs.minutes ?? 0), cost_usd: Math.round((runs.cost ?? 0) * 100) / 100,
  };
}
