import { ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import type { NewRunInput, NewTurnInput, RunDto, RunEventDto, RunEventKind, TurnDto } from '../src/app/shared/contract';
import { moveTaskForRun } from './backlog';
import { DEV_ROOT, all, get, now, run } from './db';
import { git, gitOr } from './git';
import { slugify } from './projects';
import { childEnv } from './workspace';

const MAX_PARALLEL = 4;
const MAX_BUDGET = 50;
// Modo "edits": edita arquivos sem perguntar e só roda os comandos desta lista.
const SAFE_TOOLS = ['Bash(git:*)', 'Bash(gh pr:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(python:*)',
  'Bash(pytest:*)', 'Bash(uv:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)', 'Bash(find:*)'];

export type Emit = { event: (e: RunEventDto) => void; update: (r: RunDto) => void; changed: () => void };
const procs = new Map<number, ChildProcess>();

export function listRuns(slug: string | null): RunDto[] {
  return all<RunDto>(`select * from runs where (? is null or project_slug = ?) order by id desc limit 200`, slug, slug)
    .map(r => ({ ...r, repo_name: basename(r.repo_path) }));
}

export const listEvents = (id: number) => all<RunEventDto>('select run_id, at, kind, text from run_events where run_id = ? order by id', id);

export function startRun(input: NewRunInput, emit: Emit, turnId: number | null = null): RunDto {
  const id = queueRun(input, turnId);
  emit.changed();
  pump(emit);
  return dto(id);
}

function queueRun(input: NewRunInput, turnId: number | null): number {
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error('Descreva o que o agente deve fazer.');
  if (!get('select 1 from repos where path = ? and project_slug = ?', input.repo_path, input.project_slug)) {
    throw new Error('Escolha um repositório do projeto.');
  }
  const budget = Math.min(Math.max(Number(input.budget_usd) || 0, 0.5), MAX_BUDGET);
  const permission = input.permission === 'full' ? 'full' : 'edits';
  const { lastInsertRowid } = run(
    'insert into runs (project_slug, proposal_id, task_id, turn_id, repo_path, prompt, permission, budget_usd) values (?,?,?,?,?,?,?,?)',
    input.project_slug, input.proposal_id ?? null, input.task_id ?? null, turnId, input.repo_path, prompt, permission, budget);
  if (input.proposal_id) run(`update proposals set status = 'running', updated_at = ? where id = ?`, now(), input.proposal_id);
  if (input.task_id) {
    moveTaskForRun(input.task_id, 'doing');
    run('update tasks set repo_path = coalesce(repo_path, ?) where id = ?', input.repo_path, input.task_id);
  }
  return Number(lastInsertRowid);
}

// ---------- turnos (M3): "deixa evoluindo até X" ----------

const TURN_SELECT = `
  select t.*,
    (select count(*) from runs r where r.turn_id = t.id) runs,
    (select count(*) from runs r where r.turn_id = t.id and r.status = 'succeeded') succeeded,
    (select count(*) from runs r where r.turn_id = t.id and r.status in ('failed','killed')) failed,
    (select count(*) from runs r where r.turn_id = t.id and r.pr_url is not null) prs,
    (select coalesce(sum(cost_usd), 0) from runs r where r.turn_id = t.id) cost_usd
  from turns t`;

export const listTurns = () => all<TurnDto>(`${TURN_SELECT} order by t.id desc limit 50`);

export function startTurn(input: NewTurnInput, emit: Emit): TurnDto {
  if (!input.items?.length) throw new Error('Escolha pelo menos uma tarefa.');
  const until = new Date(input.until);
  if (isNaN(until.getTime()) || until.getTime() < Date.now() + 10 * 60_000) {
    throw new Error('O horário limite precisa estar pelo menos 10 minutos à frente.');
  }
  const budget = Math.min(Math.max(Number(input.budget_usd) || 0, 1), MAX_BUDGET * input.items.length);
  const each = Math.round((budget / input.items.length) * 100) / 100;
  const tasks = input.items.map(i => {
    const t = get<{ id: number; title: string; body: string | null; project_slug: string; column: string }>(
      'select id, title, body, project_slug, "column" from tasks where id = ?', i.task_id);
    if (!t || t.project_slug !== input.project_slug) throw new Error('Tarefa de outro projeto.');
    if (t.column === 'doing') throw new Error(`"${t.title}" já está com um agente.`);
    return { ...t, repo_path: i.repo_path };
  });

  const { lastInsertRowid } = run('insert into turns (project_slug, until, budget_usd) values (?,?,?)',
    input.project_slug, until.toISOString(), budget);
  const turnId = Number(lastInsertRowid);
  for (const t of tasks) {
    queueRun({
      project_slug: input.project_slug, repo_path: t.repo_path, prompt: [t.title, t.body].filter(Boolean).join('\n\n'),
      budget_usd: each, permission: input.permission, proposal_id: null, task_id: t.id,
    }, turnId);
  }
  emit.changed();
  pump(emit);
  return get<TurnDto>(`${TURN_SELECT} where t.id = ?`, turnId)!;
}

export function stopTurn(id: number, emit: Emit): void {
  for (const { id: runId } of all<{ id: number }>(`select id from runs where turn_id = ? and status in ('queued','preparing','running')`, id)) {
    killRun(runId, emit);
  }
  run(`update turns set status = 'stopped', finished_at = coalesce(finished_at, ?) where id = ? and status = 'running'`, now(), id);
  emit.changed();
}

/** A cada 30s: para turnos que passaram do horário e fecha os que terminaram. */
export function watchTurns(emit: Emit): void {
  setInterval(() => {
    for (const t of all<{ id: number; until: string }>(`select id, until from turns where status = 'running'`)) {
      if (Date.parse(t.until) < Date.now()) { stopTurn(t.id, emit); continue; }
      const open = get<{ n: number }>(`select count(*) n from runs where turn_id = ? and status in ('queued','preparing','running')`, t.id)!.n;
      if (!open) { run(`update turns set status = 'done', finished_at = ? where id = ?`, now(), t.id); emit.changed(); }
    }
  }, 30_000);
}

export function killRun(id: number, emit: Emit): void {
  const proc = procs.get(id);
  if (proc?.pid) execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
  const r = dto(id);
  if (['queued', 'preparing', 'running'].includes(r.status)) {
    finish(id, 'killed', 'Interrompido por você.', null, emit);
  }
}

const dto = (id: number): RunDto => {
  const r = get<RunDto>('select * from runs where id = ?', id)!;
  return { ...r, repo_name: basename(r.repo_path) };
};

function event(id: number, kind: RunEventKind, text: string, emit: Emit): void {
  const e = { run_id: id, at: now(), kind, text };
  run('insert into run_events (run_id, at, kind, text) values (?,?,?,?)', id, e.at, kind, text);
  emit.event(e);
}

function set(id: number, fields: Record<string, string | number | null>, emit: Emit): void {
  run(`update runs set ${Object.keys(fields).map(k => `${k} = ?`).join(', ')} where id = ?`, ...Object.values(fields), id);
  emit.update(dto(id));
}

function finish(id: number, status: 'succeeded' | 'failed' | 'killed', result: string | null, cost: number | null, emit: Emit) {
  const pr = result?.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/)?.[0] ?? null;
  set(id, { status, result, cost_usd: cost, pr_url: pr, finished_at: now() }, emit);
  const { proposal_id: proposal, task_id: task } = dto(id);
  if (proposal) run('update proposals set status = ?, updated_at = ? where id = ?', status === 'succeeded' ? 'done' : 'approved', now(), proposal);
  // concluída vai para Revisão (alguém precisa olhar o PR); falha volta para A fazer
  if (task) moveTaskForRun(task, status === 'succeeded' ? 'review' : 'todo', pr);
  procs.delete(id);
  emit.changed();
  pump(emit);
}

/** Inicia as execuções na fila até o limite de paralelas. */
function pump(emit: Emit): void {
  const active = get<{ n: number }>(`select count(*) n from runs where status in ('preparing','running')`)!.n;
  const next = all<{ id: number }>(`select id from runs where status = 'queued' order by id limit ?`, Math.max(MAX_PARALLEL - active, 0));
  for (const { id } of next) execute(id, emit).catch(e => {
    event(id, 'error', String(e?.message ?? e), emit);
    finish(id, 'failed', String(e?.message ?? e), null, emit);
  });
}

async function execute(id: number, emit: Emit): Promise<void> {
  set(id, { status: 'preparing', started_at: now() }, emit);
  const r = dto(id);

  event(id, 'system', 'Atualizando o repositório…', emit);
  await gitOr(r.repo_path, ['fetch', 'origin', '--quiet'], '');
  const head = (await gitOr(r.repo_path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], '')).trim();
  const base = head.replace(/^origin\//, '') || (await git(r.repo_path, ['branch', '--show-current'])).trim();
  const startPoint = head || 'HEAD';
  const branch = `central/run-${id}-${slugify(r.prompt).slice(0, 30)}`;
  // Fora de qualquer repo: se a pasta do projeto for o próprio repo, a cópia não aparece como mudança nele.
  const worktrees = join(DEV_ROOT, '.central-worktrees', r.project_slug);
  const worktree = join(worktrees, `${r.repo_name}-run-${id}`);
  mkdirSync(worktrees, { recursive: true });
  await git(r.repo_path, ['worktree', 'add', '-b', branch, worktree, startPoint]);
  set(id, { worktree_path: worktree, branch, base_branch: base }, emit);
  event(id, 'system', `Worktree criada em ${worktree}, branch ${branch} a partir de ${startPoint}.`, emit);

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', String(r.budget_usd)];
  if (r.permission === 'full') args.push('--permission-mode', 'bypassPermissions');
  else args.push('--permission-mode', 'acceptEdits', '--allowedTools', SAFE_TOOLS.join(','));

  // Prompt vai por stdin: nenhum texto do usuário passa pela linha de comando do shell.
  const child = spawn('claude', args, { cwd: worktree, shell: true, windowsHide: true, env: childEnv() });
  procs.set(id, child);
  set(id, { status: 'running' }, emit);
  child.stdin.end(framePrompt(r.prompt, r.repo_name, branch, base));

  let result: string | null = null, cost: number | null = null, isError = false;
  createInterface({ input: child.stdout }).on('line', line => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text.trim()) event(id, 'text', block.text.trim(), emit);
        if (block.type === 'tool_use') event(id, 'tool', describeTool(block.name, block.input), emit);
      }
    } else if (msg.type === 'result') {
      result = msg.result ?? null;
      cost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null;
      isError = !!msg.is_error;
      event(id, isError ? 'error' : 'result', result ?? msg.subtype ?? 'Terminou.', emit);
    }
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });

  await new Promise<void>(done => child.on('close', code => {
    if (dto(id).status === 'killed') return done();
    if (code !== 0 && !result) event(id, 'error', stderr.trim() || `claude saiu com código ${code}.`, emit);
    finish(id, code === 0 && !isError ? 'succeeded' : 'failed', result ?? (stderr.trim() || null), cost, emit);
    done();
  }));
}

function framePrompt(task: string, repo: string, branch: string, base: string): string {
  return `Você é um agente da Central trabalhando sozinho, sem ninguém para responder perguntas.

Repositório: ${repo}. Você está numa git worktree isolada, na branch \`${branch}\`, criada a partir de \`${base}\`.

## Tarefa
${task}

## Regras
- Trabalhe só nesta branch. Nunca faça push para main, master ou develop.
- Leia o CLAUDE.md do repositório, se existir, e siga as convenções dele.
- Rode build/testes que existirem antes de concluir.
- Ao terminar: faça commit, \`git push -u origin ${branch}\` e abra um PR draft com \`gh pr create --draft --base ${base}\`.
- Se não for possível concluir, explique exatamente o que falta.
- Termine com um resumo curto em português do que mudou, como verificar e o link do PR.`;
}

function describeTool(name: string, input: any): string {
  const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 160);
  switch (name) {
    case 'Bash': return `$ ${s(input?.command)}`;
    case 'Read': return `Lendo ${s(input?.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Editando ${s(input?.file_path)}`;
    case 'Write': return `Criando ${s(input?.file_path)}`;
    case 'Grep': return `Buscando "${s(input?.pattern)}"`;
    case 'Glob': return `Listando ${s(input?.pattern)}`;
    case 'TodoWrite': return 'Atualizando plano';
    default: return `${name} ${s(JSON.stringify(input))}`;
  }
}
