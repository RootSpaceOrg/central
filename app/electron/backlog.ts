/** Ideias, tarefas (Kanban), importação de pendências (M2) e configurações. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';

import type {
  IdeaDto, IdeaPatch, ImportResultDto, NewIdeaInput, NewProposalInput, NewTaskInput, ProposalDto, ProposalStatus, TaskColumn, TaskDto,
  TaskPatch, Verdict,
} from '../src/app/shared/contract';
import { resolveBoard, resolveStage, setStage } from './board';
import { all, get, now, run } from './db';
import { pool } from './git';

const execFileP = promisify(execFile);
const COLUMNS: TaskColumn[] = ['backlog', 'todo', 'doing', 'review', 'dev', 'done'];

// ---------- configurações ----------

export const getSetting = (key: string) => get<{ value: string }>('select value from settings where key = ?', key)?.value ?? null;
export const setSetting = (key: string, value: string) =>
  run('insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', key, value);

// ---------- decisões ----------

const VERDICT: Record<Verdict, ProposalStatus> = { approve: 'approved', defer: 'deferred', reject: 'rejected' };

export function listProposals(statuses: ProposalStatus[]): ProposalDto[] {
  return all<ProposalDto>(`select id, project_slug, title, body, tier, est_attention_min, next_action, status, source, created_at, updated_at, task_id, summary, options, agent_id
    from proposals where status in (${statuses.map(() => '?').join(',') || "''"})
    order by coalesce(tier, 9), created_at desc`, ...statuses);
}

export function createProposal(input: NewProposalInput & { next_action?: string | null; tier?: number | null; source?: string; task_id?: number | null; summary?: string | null; options?: string[] | null; agent_id?: number | null }): ProposalDto {
  const title = input.title?.trim();
  if (!title) throw new Error('Escreva o que precisa acontecer.');
  const tier = input.tier === 0 || input.tier === 1 || input.tier === 2 ? input.tier : null;
  const { lastInsertRowid } = run(`insert into proposals (project_slug, title, body, next_action, tier, source, source_ref) values (?,?,?,?,?,?,?)`,
    input.project_slug || null, title, input.body?.trim() || null, input.next_action?.trim() || null, tier,
    input.source ?? 'manual', `${Date.now()}-${Math.random()}`);
  const options = (input.options ?? []).map(o => o.trim()).filter(Boolean).slice(0, 4);
  run('update proposals set summary = ?, options = ? where id = ?', input.summary?.trim().split('\n')[0] || null, options.length ? JSON.stringify(options) : null, Number(lastInsertRowid));
  if (input.agent_id) run('update proposals set agent_id = ? where id = ?', input.agent_id, Number(lastInsertRowid));
  if (input.task_id && get('select 1 from tasks where id = ?', input.task_id)) run('update proposals set task_id = ? where id = ?', input.task_id, Number(lastInsertRowid));
  return get<ProposalDto>('select * from proposals where id = ?', Number(lastInsertRowid))!;
}

/** Apaga uma decisão (e a mensagem de WhatsApp que esperava por ela). Tarefas e execuções ligadas só perdem o vínculo. */
export function deleteProposal(id: number): void {
  run(`delete from wa_outbox where proposal_id = ? and status = 'pending'`, id);
  if (!run('delete from proposals where id = ?', id).changes) throw new Error('Decisão não encontrada.');
}

/** Quem reage a uma decisão (ex.: WhatsApp manda a mensagem aprovada). true = tratou, o resto não roda. */
const decidedHooks: ((p: ProposalDto, verdict: Verdict) => boolean)[] = [];
export const onDecided = (fn: (p: ProposalDto, verdict: Verdict) => boolean) => { decidedHooks.push(fn); };

/** Aprovar vira tarefa em "A fazer", pronta para um agente. */
export function decide(id: number, verdict: Verdict, reason: string | null): void {
  if (!VERDICT[verdict]) throw new Error('Decisão inválida.');
  if (!run('update proposals set status = ?, updated_at = ? where id = ?', VERDICT[verdict], now(), id).changes) {
    throw new Error('Decisão não encontrada.');
  }
  run('insert into decisions (proposal_id, verdict, reason) values (?,?,?)', id, verdict, reason);
  const p = get<ProposalDto>('select * from proposals where id = ?', id)!;
  for (const h of decidedHooks) if (h(p, verdict)) return;
  // escolha sobre uma tarefa que já existe: a resposta volta para ela (vai para A fazer, o responsável segue) em vez de
  // virar uma tarefa nova que repete a pergunta
  const task = p.task_id ? get<{ id: number; body: string | null; column: string }>('select id, body, "column" from tasks where id = ?', p.task_id) : null;
  if (task && verdict !== 'defer') {
    const when = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const answer = `Decisão #${p.id} (${when}): ${verdict === 'approve' ? 'APROVADA' : 'RECUSADA'}: ${p.title}${p.next_action && verdict === 'approve' ? `\nSe aprovada: ${p.next_action}` : ''}${reason ? `\nGustavo: ${reason}` : ''}`;
    run(`update tasks set body = ?, "column" = case when "column" = 'done' then 'done' else 'todo' end, updated_at = ? where id = ?`,
      [task.body?.trim(), answer].filter(Boolean).join('\n\n'), now(), task.id);
    return;
  }
  if (verdict === 'approve' && p.project_slug && !get('select 1 from tasks where proposal_id = ?', id)) {
    // decisões do piloto e dos agentes dizem o repositório no texto: a tarefa já nasce sabendo onde trabalhar
    const text = `${p.title}
${p.body ?? ''}
${p.next_action ?? ''}`.toLowerCase();
    const repo = all<{ path: string; name: string }>('select path, name from repos where project_slug = ?', p.project_slug)
      .find(r => text.includes(r.path.toLowerCase()) || text.includes(`repo ${r.name.toLowerCase()}`));
    createTask({
      project_slug: p.project_slug, repo_path: repo?.path ?? null, title: p.title,
      body: [p.body, p.next_action && `Próximo passo esperado: ${p.next_action}`, reason && `Gustavo: ${reason}`].filter(Boolean).join('\n\n') || null,
      column: 'todo', priority: p.tier === 2 ? 0 : 1, proposal_id: id,
    });
  }
}

// ---------- ideias ----------

export const listIdeas = () => all<IdeaDto>(`select i.id, i.project_slug, i.title, i.body, i.status, i.source, i.source_ref, i.task_id, i.created_at,
    i.author, i.approved_at, i.milestone_id, i.triaged_at, i.triage,
    (select count(*) from tasks t where t.idea_id = i.id) tasks,
    (select count(*) from tasks t where t.idea_id = i.id and t."column" = 'done') tasks_done
  from ideas i order by case i.status when 'new' then 0 when 'approved' then 1 when 'doing' then 2 when 'done' then 3 else 4 end,
    i.created_at desc, i.id desc`);

const IDEA_STATUS = ['new', 'approved', 'doing', 'done', 'archived'];

/** Ideia nova vai para a triagem. author = 'gustavo' ou o nome do agente que sugeriu. */
export function createIdea(input: NewIdeaInput & { source?: string; author?: string; milestone_id?: number | null }): IdeaDto {
  const title = input.title?.trim();
  if (!title) throw new Error('Escreva a ideia.');
  const { lastInsertRowid } = run(`insert into ideas (project_slug, title, body, source, source_ref, author) values (?,?,?,?,?,?)`,
    input.project_slug || null, title, input.body?.trim() || null, input.source ?? 'manual', `${Date.now()}-${Math.random()}`, input.author ?? 'gustavo');
  if (input.milestone_id) run('update ideas set milestone_id = ? where id = ?', input.milestone_id, Number(lastInsertRowid));
  return listIdeas().find(i => i.id === Number(lastInsertRowid))!;
}

export function updateIdea(id: number, patch: IdeaPatch): void {
  const allowed = ['title', 'body', 'project_slug', 'status', 'milestone_id', 'triage'] as const;
  const fields = allowed.filter(k => k in patch && patch[k] !== undefined);
  if (patch.status && !IDEA_STATUS.includes(patch.status)) throw new Error('Status inválido.');
  if (patch.status === 'approved') {
    const slug = patch.project_slug ?? get<{ p: string | null }>('select project_slug p from ideas where id = ?', id)?.p;
    if (!slug) throw new Error('Diga de qual projeto é a ideia antes de aprovar.');
  }
  if (!fields.length) return;
  run(`update ideas set ${fields.map(k => `${k} = ?`).join(', ')} where id = ?`, ...fields.map(k => (patch[k] ?? null) as string | null), id);
  if (patch.status === 'approved') run('update ideas set approved_at = coalesce(approved_at, ?) where id = ?', now(), id);
}

/** Ideia em andamento termina sozinha quando todas as tarefas ligadas a ela chegam em Feito. */
export function syncIdeaProgress(ideaId: number | null): void {
  if (!ideaId) return;
  const c = get<{ n: number; done: number }>(`select count(*) n, sum("column" = 'done') done from tasks where idea_id = ?`, ideaId)!;
  if (c.n && c.n === c.done) run(`update ideas set status = 'done' where id = ? and status in ('approved','doing')`, ideaId);
  else if (c.n) run(`update ideas set status = 'doing' where id = ? and status in ('approved','done')`, ideaId);
}

export function promoteIdea(id: number, projectSlug: string): TaskDto {
  const idea = get<IdeaDto>('select * from ideas where id = ?', id);
  if (!idea) throw new Error('Ideia não encontrada.');
  if (idea.task_id) throw new Error('Essa ideia já virou tarefa.');
  const task = createTask({ project_slug: projectSlug, repo_path: null, title: idea.title, body: idea.body, column: 'backlog', priority: 2 });
  run('update tasks set idea_id = ? where id = ?', id, task.id);
  run(`update ideas set status = 'doing', task_id = ?, project_slug = ?, approved_at = coalesce(approved_at, ?) where id = ?`, task.id, projectSlug, now(), id);
  return getTask(task.id);
}

// ---------- tarefas ----------

const TASK_SELECT = `
  select t.id, t.project_slug, t.repo_path, t.title, t.body, t."column", t.color, t.priority, t.position, t.pr_url, t.depends_on,
         t.proposal_id, t.idea_id, t.milestone_id, t.created_at, t.updated_at,
         r.id run_id, r.status run_status
  from tasks t
  left join runs r on r.id = (select max(id) from runs where task_id = t.id)`;

export const getTask = (id: number) => get<TaskDto>(`${TASK_SELECT} where t.id = ?`, id)!;

export const listTasks = (slug: string | null) => all<TaskDto>(`${TASK_SELECT}
  left join projects p on p.slug = t.project_slug
  where (? is null and coalesce(p.status, '') <> 'dead' or t.project_slug = ?)
  order by t.position, t.priority, t.created_at desc`, slug, slug);

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase() === b.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
/**
 * Onde um agente trabalha nesta tarefa: um repositório do projeto, ou null (o projeto inteiro). A pasta do projeto vira
 * null; outro caminho que não é do projeto é recusado (senão a tarefa nunca começaria).
 */
export function taskRepo(slug: string | null, path: string | null | undefined): string | null {
  if (!path?.trim() || !slug) return null;
  if (get('select 1 from repos where path = ? and project_slug = ?', path, slug)) return path;
  const folder = get<{ folder: string }>('select folder from projects where slug = ?', slug)?.folder;
  if (folder && samePath(folder, path)) return null;
  const repo = all<{ path: string }>('select path from repos where project_slug = ?', slug).find(r => samePath(r.path, path));
  if (repo) return repo.path;
  throw new Error(`Esse repositório não é do projeto: ${path}. Use um dos repositórios do projeto (list_projects) ou deixe vazio para o projeto inteiro.`);
}

/** dependências: ids de tarefas que precisam ser entregues antes (em Revisão, Em dev ou Feito) */
function dependsOn(id: number | null, deps: number[] | null | undefined): string | null {
  const list = [...new Set((deps ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== id))];
  for (const d of list) if (!get('select 1 from tasks where id = ?', d)) throw new Error(`Tarefa #${d} não existe.`);
  return list.length ? JSON.stringify(list) : null;
}

export function createTask(input: NewTaskInput & { board_id?: number | null; stage?: string | null; proposal_id?: number | null; idea_id?: number | null; milestone_id?: number | null; pr_url?: string | null; source?: string; source_ref?: string }): TaskDto {
  const title = input.title?.trim();
  if (!title) throw new Error('Dê um título à tarefa.');
  if (input.project_slug ? !get('select 1 from projects where slug = ?', input.project_slug) : !input.board_id) throw new Error('Escolha um projeto (ou crie a tarefa num quadro).');
  if (input.board_id && !resolveBoard(input.board_id)) throw new Error('Quadro não encontrado.');
  const column = COLUMNS.includes(input.column) ? input.column : 'backlog';
  const top = get<{ p: number | null }>('select min(position) p from tasks where "column" = ?', column)!.p ?? 1;
  const { lastInsertRowid } = run(`insert into tasks (project_slug, repo_path, title, body, "column", priority, position, proposal_id, pr_url, source, source_ref)
    values (?,?,?,?,?,?,?,?,?,?,?)`,
    input.project_slug || null, taskRepo(input.project_slug, input.repo_path), title, input.body?.trim() || null, column,
    Math.min(Math.max(Number(input.priority) || 0, 0), 3), top - 1,
    input.proposal_id ?? null, input.pr_url ?? null, input.source ?? null, input.source_ref ?? null);
  const id = Number(lastInsertRowid);
  if (input.depends_on?.length) run('update tasks set depends_on = ? where id = ?', dependsOn(id, input.depends_on), id);
  // pedido feito num quadro: já entra na coluna dele (a primeira, ou a pedida)
  if (input.board_id) {
    const stage = (input.stage && resolveStage(input.board_id, input.stage)) || get<{ k: string }>('select key k from board_cols where board_id = ? order by position limit 1', input.board_id)?.k;
    if (stage) setStage(id, input.board_id, stage);
  }
  if (input.milestone_id && get('select 1 from milestones where id = ?', input.milestone_id)) run('update tasks set milestone_id = ? where id = ?', input.milestone_id, id);
  if (input.idea_id) {
    if (!get('select 1 from ideas where id = ?', input.idea_id)) throw new Error('Ideia não encontrada.');
    run('update tasks set idea_id = ? where id = ?', input.idea_id, id);
    syncIdeaProgress(input.idea_id);
  }
  return getTask(id);
}

export function updateTask(id: number, input: TaskPatch): void {
  const patch = input;
  const task = get<TaskDto>('select * from tasks where id = ?', id);
  if (!task) throw new Error('Tarefa não encontrada.');
  if (patch.column && !COLUMNS.includes(patch.column)) throw new Error('Coluna inválida.');

  if (patch.color !== undefined && patch.color !== null && !/^#[0-9a-fA-F]{6}$/.test(patch.color)) throw new Error('Cor inválida.');
  if (patch.repo_path !== undefined) patch.repo_path = taskRepo(patch.project_slug ?? task.project_slug, patch.repo_path);
  if (patch.depends_on !== undefined) run('update tasks set depends_on = ?, updated_at = ? where id = ?', dependsOn(id, patch.depends_on), now(), id);
  const simple = (['title', 'body', 'project_slug', 'repo_path', 'priority', 'milestone_id', 'color'] as const).filter(k => k in patch && patch[k] !== undefined);
  if (simple.length) {
    run(`update tasks set ${simple.map(k => `${k} = ?`).join(', ')}, updated_at = ? where id = ?`,
      ...simple.map(k => (patch[k] ?? null) as string | number | null), now(), id);
  }
  if (patch.column !== undefined || patch.position !== undefined) {
    const column = patch.column ?? task.column;
    // renumera a coluna de destino com a tarefa na posição pedida
    const others = all<{ id: number }>('select id from tasks where "column" = ? and id <> ? order by position, priority, created_at desc', column, id);
    const at = Math.min(Math.max(patch.position ?? 0, 0), others.length);
    others.splice(at, 0, { id });
    run('begin');
    try {
      others.forEach((t, i) => run('update tasks set position = ? where id = ?', i, t.id));
      run('update tasks set "column" = ?, updated_at = ? where id = ?', column, now(), id);
      run('commit');
    } catch (e) { run('rollback'); throw e; }
  }
  syncIdeaProgress(get<{ i: number | null }>('select idea_id i from tasks where id = ?', id)?.i ?? null);
}

export function deleteTask(id: number): void {
  // a ideia continua aprovada: a tarefa apagada não era a ideia
  run(`update ideas set status = 'approved', task_id = null where task_id = ?`, id);
  run('delete from tasks where id = ?', id);
}

/** Chamado pelos agentes: a tarefa anda no quadro conforme a execução. */
export function moveTaskForRun(taskId: number, column: TaskColumn, prUrl: string | null = null): void {
  run(`update tasks set "column" = ?, pr_url = coalesce(?, pr_url), updated_at = ? where id = ?`, column, prUrl, now(), taskId);
  syncIdeaProgress(get<{ i: number | null }>('select idea_id i from tasks where id = ?', taskId)?.i ?? null);
}

/**
 * Tarefas com PR andam sozinhas. Projeto "pronto = merge": PR mergeado vai para Feito. Projeto "pronto = produção":
 * mergeado em develop vai para Em dev; quando o merge chega em main (ou foi direto em main), Feito. Devolve quantas andaram.
 */
export async function syncPullRequests(): Promise<number> {
  const tasks = all<{ id: number; pr_url: string; col: string; prod: number; slug: string }>(`
    select t.id, t.pr_url, t."column" col, p.done_when = 'prod' prod, t.project_slug slug from tasks t join projects p on p.slug = t.project_slug
    where t.pr_url is not null and (t."column" = 'review' or (t."column" = 'dev' and p.done_when = 'prod'))`);
  const fetched = new Map<string, Promise<unknown>>();
  let moved = 0;
  const move = (t: { id: number; col: string }, to: TaskColumn) => { if (t.col !== to) { moveTaskForRun(t.id, to); moved++; } };
  await pool(tasks, 4, async t => {
    try {
      const { stdout } = await execFileP('gh', ['pr', 'view', t.pr_url, '--json', 'state,baseRefName,mergeCommit'], { windowsHide: true });
      const pr = JSON.parse(stdout) as { state: string; baseRefName: string; mergeCommit: { oid: string } | null };
      if (pr.state !== 'MERGED') return;
      if (!t.prod || /^(main|master)$/.test(pr.baseRefName)) return move(t, 'done');
      // mergeado em develop: chegou em main?
      const name = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(t.pr_url)?.[1]?.toLowerCase();
      const repo = all<{ path: string; remote: string | null }>('select path, remote from repos where project_slug = ?', t.slug)
        .find(r => githubName(r.remote)?.toLowerCase() === name);
      if (!repo || !pr.mergeCommit) return move(t, 'dev');
      if (!fetched.has(repo.path)) fetched.set(repo.path, execFileP('git', ['-C', repo.path, 'fetch', 'origin', '--quiet'], { windowsHide: true, timeout: 45_000 }).catch(() => null));
      await fetched.get(repo.path);
      const prodRef = await execFileP('git', ['-C', repo.path, 'rev-parse', '--verify', '--quiet', 'origin/main'], { windowsHide: true }).then(() => 'origin/main', () => 'origin/master');
      const inProd = await execFileP('git', ['-C', repo.path, 'merge-base', '--is-ancestor', pr.mergeCommit.oid, prodRef], { windowsHide: true }).then(() => true, () => false);
      move(t, inProd ? 'done' : 'dev');
    } catch { /* PR apagado, sem acesso ou offline: deixa como está */ }
  });
  return moved;
}

/** owner/repo a partir do remote do GitHub */
export function githubName(remote: string | null): string | null {
  const m = remote?.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Sentinela de CI: em cada repositório com commits nos últimos 14 dias, se a última execução do GitHub Actions
 * na branch padrão falhou, abre uma decisão (uma por repositório enquanto ela estiver esperando).
 * Devolve quantas decisões novas criou.
 */
export async function syncCiFailures(): Promise<number> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const repos = all<{ path: string; name: string; project_slug: string; remote: string | null; default_branch: string | null }>(`
    select r.path, r.name, r.project_slug, r.remote, r.default_branch from repos r
    join projects p on p.slug = r.project_slug
    where p.status in ('active','maintenance') and r.remote like '%github.com%'
      and exists (select 1 from commits c where c.repo_path = r.path and c.committed_at >= ?)
    limit 60`, since);
  let created = 0;
  await pool(repos, 4, async r => {
    const full = githubName(r.remote);
    if (!full) return;
    // develop = deploy em dev, main = produção (e a padrão do repo, se for outra)
    for (const branch of [...new Set(['main', 'develop', r.default_branch].filter(Boolean) as string[])]) {
      try {
        const { stdout } = await execFileP('gh', ['run', 'list', '-R', full, '--branch', branch, '--limit', '1',
          '--json', 'databaseId,conclusion,status,url,displayTitle,workflowName,createdAt'], { windowsHide: true });
        const last = (JSON.parse(stdout) as { databaseId: number; conclusion: string; status: string; url: string; displayTitle: string; workflowName: string; createdAt: string }[])[0];
        if (!last || last.status !== 'completed' || last.conclusion !== 'failure') continue;
        if (get(`select 1 from proposals where source = 'ci' and status = 'proposed' and source_ref like ?`, `${full}@${branch}#%`)) continue;
        const res = run(`insert or ignore into proposals (project_slug, title, body, next_action, tier, source, source_ref) values (?,?,?,?,?,'ci',?)`,
          r.project_slug, `CI falhando em ${r.name} (${branch})`,
          `O workflow "${last.workflowName}" falhou em ${new Date(last.createdAt).toLocaleString('pt-BR')}, no commit "${last.displayTitle}".
${last.url}`,
          'Um agente abre o log da falha, encontra a causa e propõe a correção num PR draft.', branch === 'main' ? 2 : 1, `${full}@${branch}#${last.databaseId}`);
        created += Number(res.changes);
      } catch { /* branch sem Actions, sem acesso ou offline */ }
    }
  });
  return created;
}

// ---------- importação de pendências (M2) ----------

// a palavra abre o nome ou vem depois de um separador: METODOLOGIA.md não é um TODO
export const PLAN_FILE = /(^|[-_ .])(roadmap|plan|todo|backlog|queue|lacunas|pendencias|pendências)[^/\\]*\.md$/i;
const SKIP = new Set(['node_modules', '.git', 'dist', '.angular', 'vendor', '.terraform', '.central', '.venv', 'venv']);
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

function findPlanFiles(root: string, depth = 3): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      const p = join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (d < depth) walk(p, d + 1); }
      else if (PLAN_FILE.test(name) && st.size < 512 * 1024) out.push(p);
    }
  };
  if (existsSync(root)) walk(root, 0);
  return out;
}

const clean = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

/** Memória do Claude → projeto: primeiro por palavra-chave no nome/descrição, depois pela pasta de origem. */
function projectForMemory(dirName: string, text: string, projects: { slug: string; name: string; folder: string }[]): string | null {
  const hay = text.toLowerCase();
  for (const p of projects) {
    const keys = [p.slug, basename(p.folder).toLowerCase(), ...p.name.toLowerCase().split(/[^a-z0-9à-ú]+/).filter(w => w.length > 4)];
    if (keys.some(k => hay.includes(k))) return p.slug;
  }
  const byFolder = projects
    .map(p => ({ slug: p.slug, enc: p.folder.replace(/[:\\/]/g, '-') }))
    .filter(p => dirName === p.enc || dirName.startsWith(`${p.enc}-`))
    .sort((a, b) => b.enc.length - a.enc.length)[0];
  return byFolder?.slug ?? null;
}

export async function importPending(): Promise<ImportResultDto> {
  const projects = all<{ slug: string; name: string; folder: string }>("select slug, name, folder from projects where status <> 'dead'");
  const sources: string[] = [];
  let ideas = 0, tasks = 0;
  const addIdea = (slug: string | null, title: string, body: string | null, source: string, ref: string) => {
    const r = run(`insert or ignore into ideas (project_slug, title, body, source, source_ref) values (?,?,?,?,?)`,
      slug, title.slice(0, 200), body, source, ref);
    ideas += Number(r.changes);
  };

  // 1. memórias de projeto do Claude Code
  const memRoot = join(process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'), 'projects');
  for (const dir of existsSync(memRoot) ? readdirSync(memRoot) : []) {
    const memDir = join(memRoot, dir, 'memory');
    if (!existsSync(memDir)) continue;
    const before = ideas;
    for (const file of readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')) {
      const text = readFileSync(join(memDir, file), 'utf8');
      const type = text.match(/^\s*type:\s*(\w+)/m)?.[1];
      if (type !== 'project' && !file.startsWith('project')) continue;
      const desc = text.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1] ?? text.match(/^name:\s*(.+)$/m)?.[1] ?? file;
      const body = text.replace(/^---[\s\S]*?---/, '').trim().slice(0, 900);
      addIdea(projectForMemory(dir, `${file} ${desc}`, projects), clean(desc), body, 'memory', join(memDir, file));
    }
    if (ideas > before) sources.push(`memórias de ${dir.split('-').pop()}`);
  }

  // 2. itens abertos "- [ ]" em ROADMAP / PLAN / TODO dos projetos
  for (const p of projects) {
    for (const file of findPlanFiles(p.folder)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let n = 0;
      const before = ideas;
      for (const line of lines) {
        const m = line.match(/^\s*[-*]\s+\[ \]\s+(.+)$/);
        if (!m || ++n > 60) continue;
        addIdea(p.slug, clean(m[1]), `De ${relative(p.folder, file)}`, 'doc', `${file}#${hash(m[1])}`);
      }
      if (ideas > before) sources.push(relative(p.folder, file));
    }
  }

  // 3. PRs abertos seus → tarefas em Revisão
  try {
    const { stdout } = await execFileP('gh', ['search', 'prs', '--state', 'open', '--author', '@me', '--limit', '200',
      '--json', 'repository,title,url,body'], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    const repos = all<{ path: string; project_slug: string; remote: string | null }>('select path, project_slug, remote from repos');
    for (const pr of JSON.parse(stdout) as { repository: { nameWithOwner: string }; title: string; url: string; body: string }[]) {
      const repo = repos.find(r => r.remote?.replace(/\.git$/, '').toLowerCase().endsWith(pr.repository.nameWithOwner.toLowerCase()));
      if (!repo || get('select 1 from tasks where source = ? and source_ref = ?', 'pr', pr.url)) continue;
      createTask({ project_slug: repo.project_slug, repo_path: repo.path, title: pr.title, body: `${pr.url}\n\n${(pr.body ?? '').slice(0, 600)}`,
        column: 'review', priority: 1, pr_url: pr.url, source: 'pr', source_ref: pr.url });
      tasks++;
    }
    sources.push('PRs abertos no GitHub');
  } catch { /* gh ausente ou offline: segue com o resto */ }

  setSetting('import:last', now());
  return { ideas, tasks, sources };
}
