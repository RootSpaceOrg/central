/**
 * Responsável pelo "A fazer": quando o Gustavo põe uma tarefa em A fazer num projeto que tem responsável, a Central coloca
 * esse agente para trabalhar nela (uma execução por tarefa, ligada a ela: nota de entrega e fila de revisão).
 * Travas: no máximo N do responsável por vez no projeto, só no horário escolhido, não dispara com a cota da sessão acima
 * de 80% e não insiste numa tarefa que não terminou nas últimas 12 h (volta para A fazer e ficaria em laço).
 */
import { all, get } from './db';

const QUOTA_CEILING = 80;
const RETRY_AFTER_H = 12;

/** "08-22" (ou "22-06", virando a noite); vazio = qualquer hora. */
export function withinHours(spec: string, now: Date): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec.trim());
  if (!m) return true;
  const [from, to, h] = [Number(m[1]), Number(m[2]), now.getHours()];
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

export interface DispatchDeps {
  /** % usado da sessão do plano (null = não sabe) */
  quota: () => Promise<number | null>;
  start: (input: { project_slug: string; agent_id: number; repo_path: string | null; prompt: string; permission: 'edits' | 'full'; task_id: number; stage?: string | null }) => void;
  now?: () => Date;
}

let lastSkip = '';
/** por que não disparou da última vez (para a tela explicar) */
export const dispatchSkip = () => lastSkip;

export async function dispatchTodo(deps: DispatchDeps): Promise<number> {
  const owners = all<{ slug: string; agent: number; parallel: number; hours: string; permission: 'edits' | 'full' }>(
    `select p.slug, p.todo_agent_id agent, p.todo_parallel parallel, p.todo_hours hours, a.permission
     from projects p join agents a on a.id = p.todo_agent_id where p.status <> 'dead'
       and not exists (select 1 from board_columns b where b.project_slug = p.slug)`);
  // quadro próprio: cada coluna com agente pega o que entra nela
  const stages = all<{ slug: string; key: string; label: string; agent: number; parallel: number; hours: string; instruction: string | null; permission: 'edits' | 'full'; next: string | null }>(
    `select b.project_slug slug, b.key, b.label, b.agent_id agent, b.parallel, b.hours, b.instruction, a.permission, n.label next
     from board_columns b join agents a on a.id = b.agent_id join projects p on p.slug = b.project_slug
     left join board_columns n on n.project_slug = b.project_slug and n.key = b.next_key
     where p.status <> 'dead'`);
  if (!owners.length && !stages.length) return 0;
  const used = await deps.quota();
  if (used !== null && used >= QUOTA_CEILING) { lastSkip = `cota da sessão em ${used}%`; return 0; }
  lastSkip = '';
  const now = deps.now?.() ?? new Date();
  let started = 0;
  for (const o of owners) {
    if (!withinHours(o.hours, now)) continue;
    const busy = get<{ n: number }>(`select count(*) n from runs where project_slug = ? and agent_id = ? and status in ('queued','preparing','running')`, o.slug, o.agent)!.n;
    const slots = Math.max(0, (o.parallel || 1) - busy);
    if (!slots) continue;
    const since = new Date(now.getTime() - RETRY_AFTER_H * 3_600_000).toISOString();
    const tasks = all<{ id: number; title: string; body: string | null; repo_path: string | null }>(
      `select t.id, t.title, t.body, t.repo_path from tasks t
       where t.project_slug = ? and t."column" = 'todo'
         and not exists (select 1 from runs r where r.task_id = t.id and (r.status in ('queued','preparing','running') or (r.status = 'failed' and r.finished_at > ?)))
       order by t.priority, t.position, t.id limit ?`, o.slug, since, slots);
    for (const t of tasks) {
      deps.start({ project_slug: o.slug, agent_id: o.agent, repo_path: t.repo_path, prompt: `${t.title}${t.body ? `\n\n${t.body}` : ''}`, permission: o.permission, task_id: t.id });
      started++;
    }
  }
  for (const s of stages) {
    if (!withinHours(s.hours, now)) continue;
    const busy = get<{ n: number }>(`select count(*) n from runs where project_slug = ? and stage = ? and status in ('queued','preparing','running')`, s.slug, s.key)!.n;
    const slots = Math.max(0, (s.parallel || 1) - busy);
    if (!slots) continue;
    const since = new Date(now.getTime() - RETRY_AFTER_H * 3_600_000).toISOString();
    const tasks = all<{ id: number; title: string; body: string | null; repo_path: string | null }>(
      `select t.id, t.title, t.body, t.repo_path from tasks t
       where t.project_slug = ? and t.stage = ?
         and not exists (select 1 from runs r where r.task_id = t.id and (r.status in ('queued','preparing','running') or (r.stage = ? and r.status = 'failed' and r.finished_at > ?) or r.waiting is not null))
         and not exists (select 1 from proposals x where x.task_id = t.id and x.status = 'proposed')
       order by t.priority, t.position, t.id limit ?`, s.slug, s.key, s.key, since, slots);
    for (const t of tasks) {
      const head = `Etapa do quadro: ${s.label}.${s.instruction ? `\n${s.instruction}` : ''}\nAo terminar bem, a Central leva a tarefa para ${s.next ?? 'Revisão'}; não mova você mesmo.`;
      deps.start({ project_slug: s.slug, agent_id: s.agent, repo_path: t.repo_path, prompt: `${head}\n\n${t.title}${t.body ? `\n\n${t.body}` : ''}`, permission: s.permission, task_id: t.id, stage: s.key });
      started++;
    }
  }
  return started;
}
