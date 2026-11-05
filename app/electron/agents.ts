import { ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import type { NewRunInput, NewTurnInput, RunDto, RunEventDto, RunEventKind, TurnDto } from '../src/app/shared/contract';
import { agentCwd, agentPromptFile, agentTools, getAgent } from './agentdefs';
import { moveTaskForRun } from './backlog';
import { nextStage, setStage } from './board';
import { INTERNAL, describe } from './central-agent';
import { DEV_ROOT, all, get, now, run } from './db';
import { closeDelivery } from './deliveries';
import { mcpConfigPath } from './mcp-config';
import { memoryBlock } from './memories';
import { getUsage, usageNow } from './usage';
import { LIMIT_HIT, PRIORITY_OF, mustPause, nextToResume, pickNext, readUsage } from './governor';
import { git, gitOr } from './git';
import { slugify } from './projects';
import { childEnv } from './workspace';
import { contextBlock, recordTouch } from './context/context';
import { snapshot, track, untrack } from './activity';

const MAX_PARALLEL = 4;
const MAX_BUDGET = 50;
// Modo "edits": edita arquivos sem perguntar e só roda os comandos desta lista.
const SAFE_TOOLS = ['Agent', 'Task', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash(git:*)', 'Bash(gh pr:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(python:*)',
  'Bash(pytest:*)', 'Bash(uv:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)', 'Bash(find:*)', 'mcp__central'];
// Projeto inteiro em modo seguro: só lê e organiza (backlog, ideias, decisões pela Central).
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite', 'Agent', 'Task', 'Bash(git log:*)', 'Bash(git status:*)',
  'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git branch:*)', 'Bash(gh pr list:*)', 'Bash(gh pr view:*)', 'Bash(gh issue list:*)',
  'Bash(gh issue view:*)', 'Bash(gh run list:*)', 'Bash(ls:*)', 'mcp__central'];

export type Emit = { event: (e: RunEventDto) => void; update: (r: RunDto) => void; changed: () => void };
const procs = new Map<number, ChildProcess>();

export function listRuns(slug: string | null): RunDto[] {
  return all<RunDto>(`select * from runs where (? is null or project_slug = ?) order by id desc limit 300`, slug, slug)
    .map(r => ({ ...r, repo_name: basename(r.repo_path) }));
}

export const listEvents = (id: number) => all<RunEventDto>('select run_id, at, kind, text from run_events where run_id = ? order by id', id);

/** O que a Central acrescenta ao pedir uma execução: etapa de quadro, urgência, quem pediu, de quem assume. */
export type RunExtra = { stage?: string | null; board_id?: number | null; urgent?: boolean; parent_run_id?: number | null; handoff_from?: number | null };

export function startRun(input: NewRunInput & RunExtra, emit: Emit, routineId: number | null = null): RunDto {
  const id = queueRun(input, null, routineId);
  emit.changed();
  pump(emit);
  return dto(id);
}

function queueRun(input: NewRunInput & RunExtra, turnId: number | null, routineId: number | null = null): number {
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error('Descreva o que o agente deve fazer.');
  const agent = input.agent_id ? getAgent(input.agent_id) : null;
  if (input.agent_id && !agent) throw new Error('Agente não encontrado.');
  if (agent?.restricted) throw new Error(`${agent.name} tem atuação restrita: só conversa (atendimento), não executa tarefas.`);
  const slug = input.project_slug || agent?.project_slug || null;
  const project = slug ? get<{ folder: string }>('select folder from projects where slug = ?', slug) : null;
  if (slug && !project) throw new Error('Projeto não encontrado.');
  if (!project && !agent) throw new Error('Escolha um projeto ou um agente.');
  // repositório → worktree; projeto → pasta do projeto; só agente → pasta própria do agente
  const scope = input.repo_path ? 'repo' : project ? 'project' : 'workspace';
  if (scope === 'repo' && !get('select 1 from repos where path = ? and project_slug = ?', input.repo_path, slug)) {
    throw new Error('Esse repositório não é do projeto.');
  }
  const where = input.repo_path ?? project?.folder ?? agentCwd(agent!);
  const budget = Math.min(Math.max(Number(input.budget_usd) || 0, 0.5), MAX_BUDGET);
  const permission = input.permission === 'full' ? 'full' : 'edits';
  const { lastInsertRowid } = run(
    `insert into runs (project_slug, agent_id, proposal_id, task_id, turn_id, routine_id, scope, repo_path, prompt, permission, budget_usd)
     values (?,?,?,?,?,?,?,?,?,?,?)`,
    slug, agent?.id ?? null, input.proposal_id ?? null, input.task_id ?? null, turnId, routineId, scope, where, prompt, permission, budget);
  if (input.stage && input.board_id) run('update runs set stage = ?, board_id = ? where id = ?', input.stage, input.board_id, Number(lastInsertRowid));
  // prioridade do agente (urgente passa à frente); cadeia de quem pediu; de quem está assumindo
  const depth = input.parent_run_id ? (get<{ d: number }>('select depth d from runs where id = ?', input.parent_run_id)?.d ?? 0) + 1 : 0;
  run('update runs set priority = ?, parent_run_id = ?, depth = ?, handoff_from = ? where id = ?',
    input.urgent ? 0 : PRIORITY_OF[agent?.priority ?? 'normal'] ?? 1, input.parent_run_id ?? null, depth, input.handoff_from ?? null, Number(lastInsertRowid));
  if (input.proposal_id) run(`update proposals set status = 'running', updated_at = ? where id = ?`, now(), input.proposal_id);
  if (input.task_id && !input.stage) {
    moveTaskForRun(input.task_id, 'doing');
    if (input.repo_path) run('update tasks set repo_path = coalesce(repo_path, ?) where id = ?', input.repo_path, input.task_id);
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

export const dto = (id: number): RunDto => {
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
  // consumo real: % da sessão do plano depois da execução
  getUsage(true).then(u => {
    const s = u.limits.find(l => l.kind === 'session');
    if (s) set(id, { usage_end: s.percent }, emit);
  });
  const { proposal_id: proposal, task_id: task } = dto(id);
  if (proposal) run('update proposals set status = ?, updated_at = ? where id = ?', status === 'succeeded' ? 'done' : 'approved', now(), proposal);
  // concluída vai para Revisão (alguém precisa olhar o PR); falha volta para A fazer
  const waiting = !!get<{ w: string | null }>('select waiting w from runs where id = ?', id)?.w;
  const asking = task ? !!get(`select 1 from proposals where task_id = ? and status = 'proposed'`, task) : false;
  const at = get<{ s: string | null; b: number | null }>('select stage s, board_id b from runs where id = ?', id);
  if (task && !waiting && !asking) {
    if (at?.s && at.b) {
      // etapa de um quadro: terminou bem → próxima coluna (a escolhida ou a seguinte); não terminou → fica na etapa
      if (pr) run('update tasks set pr_url = coalesce(?, pr_url) where id = ?', pr, task);
      const next = status === 'succeeded' ? nextStage(at.b, at.s) : null;
      if (next) setStage(task, at.b, next);
    } else moveTaskForRun(task, status === 'succeeded' ? 'review' : 'todo', pr);
  }
  procs.delete(id);
  // nota de entrega: garante, mede o diff e decide se vai para a revisão
  closeDelivery(id).catch(() => {}).finally(() => emit.changed());
  emit.changed();
  pump(emit);
}

/**
 * Inicia o que está na fila até o limite de paralelas: por prioridade, respeitando o freio da cota (governor.ts).
 * Pausadas ficam na fila (seguram a tarefa) até o freio retomar.
 */
export function pump(emit: Emit): void {
  const active = get<{ n: number }>(`select count(*) n from runs where status in ('preparing','running')`)!.n;
  const queued = all<{ id: number; priority: number; created_at: string; paused: string | null }>(
    `select id, priority, created_at, paused from runs where status = 'queued'`);
  const next = pickNext(queued, active, MAX_PARALLEL, readUsage(usageNow()), Date.now());
  for (const id of next) execute(id, emit).catch(e => {
    event(id, 'error', String(e?.message ?? e), emit);
    finish(id, 'failed', String(e?.message ?? e), null, emit);
  });
}

async function execute(id: number, emit: Emit): Promise<void> {
  set(id, { status: 'preparing', started_at: now() }, emit);
  const r = dto(id);
  const session = (await getUsage(true)).limits.find(l => l.kind === 'session');
  if (session) set(id, { usage_start: session.percent }, emit);

  const agent = r.agent_id ? getAgent(r.agent_id) : null;
  // pausada pelo freio (ou pela Central fechando): continua na mesma sessão do Claude, de onde parou
  const resuming = !!(r.resume && r.session_id);
  const from = r.handoff_from ? dto(r.handoff_from) : null;
  let cwd: string, frame: string;
  if (resuming) {
    cwd = r.worktree_path ?? r.repo_path;
    frame = `A Central pausou você (${r.resume}) para não estourar a cota do plano do Gustavo. Já pode continuar.
Continue exatamente de onde parou, sem refazer o que já fez. Confira o estado (git status, seu plano) e termine a tarefa; no fim, chame report_delivery.`;
    set(id, { resume: null }, emit);
    event(id, 'system', `Retomando a mesma sessão do Claude em ${cwd}.`, emit);
  } else if (from?.worktree_path && r.scope === 'repo') {
    // assumindo o trabalho de outra execução: a mesma branch, sem recomeçar
    cwd = from.worktree_path;
    if (!existsSync(cwd)) await git(r.repo_path, ['worktree', 'add', cwd, from.branch!]);
    set(id, { worktree_path: cwd, branch: from.branch, base_branch: from.base_branch }, emit);
    event(id, 'system', `Assumindo o trabalho da execução #${from.id} na branch ${from.branch}.`, emit);
    frame = framePrompt(r, { kind: 'repo', branch: from.branch!, base: from.base_branch ?? 'main' });
  } else if (r.scope === 'workspace') {
    cwd = r.repo_path;
    event(id, 'system', `Trabalhando na pasta do agente, ${cwd}.`, emit);
    frame = framePrompt(r, { kind: 'workspace', folder: cwd });
  } else if (r.scope === 'project') {
    cwd = r.repo_path;
    const repos = all<{ name: string }>('select name from repos where project_slug = ? order by name', r.project_slug).map(x => x.name);
    event(id, 'system', `Trabalhando na pasta do projeto, ${cwd}${r.permission === 'edits' ? ', só leitura' : ''}.`, emit);
    frame = framePrompt(r, { kind: 'project', folder: cwd, repos });
  } else {
    event(id, 'system', 'Atualizando o repositório…', emit);
    await gitOr(r.repo_path, ['fetch', 'origin', '--quiet'], '');
    const head = (await gitOr(r.repo_path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], '')).trim();
    const base = head.replace(/^origin\//, '') || (await git(r.repo_path, ['branch', '--show-current'])).trim();
    const startPoint = head || 'HEAD';
    const branch = `central/run-${id}-${slugify(r.prompt).slice(0, 30)}`;
    // Fora de qualquer repo: se a pasta do projeto for o próprio repo, a cópia não aparece como mudança nele.
    const worktrees = join(DEV_ROOT, '.central-worktrees', r.project_slug!);
    cwd = join(worktrees, `${r.repo_name}-run-${id}`);
    mkdirSync(worktrees, { recursive: true });
    await git(r.repo_path, ['worktree', 'add', '-b', branch, cwd, startPoint]);
    set(id, { worktree_path: cwd, branch, base_branch: base }, emit);
    event(id, 'system', `Worktree criada em ${cwd}, branch ${branch} a partir de ${startPoint}.`, emit);
    frame = framePrompt(r, { kind: 'repo', branch, base });
  }

  // mapa do código focado na tarefa + memória do projeto (índice local da Central); na retomada a sessão já tem tudo
  if (r.project_slug && !resuming) {
    const ctx = contextBlock(r.project_slug, [r.prompt], r.scope === 'repo' ? 2000 : 1500);
    if (ctx) frame += `\n\n${ctx}`;
  }
  if (!agent && !resuming) frame += `\n\n${memoryBlock(null)}`;
  if (from && !resuming) frame += `\n\n${await handoffBlock(from, cwd)}`;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', String(r.budget_usd)];
  if (resuming) args.push('--resume', r.session_id!);
  const mcp = mcpConfigPath({ kind: 'run', id });
  if (mcp) args.push('--mcp-config', `"${mcp}"`);
  // agente: papel, ferramentas extras (ex.: mcp__sentry) e modelo dele
  const extra = agent ? agentTools(agent) : [];
  if (agent) args.push('--append-system-prompt-file', `"${agentPromptFile(agent)}"`);
  if (agent?.model) args.push('--model', agent.model);
  if (r.permission === 'full') args.push('--permission-mode', 'bypassPermissions');
  else if (r.scope === 'repo') args.push('--permission-mode', 'acceptEdits', '--allowedTools', `"${[...new Set([...SAFE_TOOLS, ...extra])].join(',')}"`);
  else args.push('--allowedTools', `"${[...new Set([...READ_TOOLS, ...extra])].join(',')}"`);

  // Prompt vai por stdin: nenhum texto do usuário passa pela linha de comando do shell.
  const child = spawn('claude', args, { cwd, shell: true, windowsHide: true, env: childEnv() });
  procs.set(id, child);
  set(id, { status: 'running' }, emit);
  child.stdin.end(frame);

  let result: string | null = null, cost: number | null = null, isError = false, sessionSaved = !!r.session_id;
  const tracker = track('run', id, describe, text => event(id, 'tool', text, emit));
  // registro de construção: plano e etapa a cada minuto (sobrevive a queda; quem assumir lê daqui)
  const saveCheckpoint = () => {
    const a = snapshot('run', id);
    if (a && (a.plan.length || a.status)) run('update runs set checkpoint = ? where id = ?', JSON.stringify({ plan: a.plan, status: a.status, at: now() }), id);
  };
  const checkpointTimer = setInterval(saveCheckpoint, 60_000);
  createInterface({ input: child.stdout }).on('line', line => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    tracker.handle(msg);
    const sub = tracker.isSubagentStep(msg);
    if (msg.type === 'system' && msg.session_id && !sessionSaved) { sessionSaved = true; set(id, { session_id: msg.session_id }, emit); }
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text.trim() && !sub) event(id, 'text', block.text.trim(), emit);
        if (block.type === 'tool_use' && !INTERNAL.has(block.name)) {
          recordTouch(block.name, block.input, { runId: id });
          const central = String(block.name).startsWith('mcp__central__');
          event(id, 'tool', `${sub ? '↳ ' : ''}${central ? `Central: ${describe(block.name, block.input)}` : describeTool(block.name, block.input)}`, emit);
          // a sessão mexeu no backlog pela Central: atualiza a tela
          if (central) setTimeout(() => emit.changed(), 1500);
        }
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
    clearInterval(checkpointTimer);
    saveCheckpoint();
    untrack('run', id, tracker);
    const now_ = dto(id);
    if (now_.status === 'killed' || now_.paused) return done(); // parada por você ou pausada pelo freio
    // bateu no limite do plano: pausa (volta sozinha quando renovar) em vez de falhar
    if ((code !== 0 || isError) && now_.session_id && LIMIT_HIT.test(`${result ?? ''}\n${stderr}`)) {
      const u = readUsage(usageNow());
      pauseRun(id, 'bateu no limite do plano', u.weekReset && (u.week ?? 0) >= 98 ? u.weekReset : u.sessionReset, emit, false);
      return done();
    }
    if (code !== 0 && !result) event(id, 'error', stderr.trim() || `claude saiu com código ${code}.`, emit);
    finish(id, code === 0 && !isError ? 'succeeded' : 'failed', result ?? (stderr.trim() || null), cost, emit);
    done();
  }));
}

/** Pausa uma execução: o processo para, ela volta para a fila segurando a tarefa e retoma na mesma sessão depois. */
export function pauseRun(id: number, reason: string, until: string | null, emit: Emit, kill = true): void {
  const r = dto(id);
  run(`update runs set status = 'queued', paused = ?, resume = ? where id = ?`,
    JSON.stringify({ reason, until, at: now() }), r.session_id ? reason : null, id);
  if (kill) { const proc = procs.get(id); if (proc?.pid) execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {}); }
  procs.delete(id);
  event(id, 'system', `Pausada: ${reason}. ${until ? 'Volta sozinha quando a cota renovar.' : 'Volta sozinha quando o freio deixar.'}`, emit);
  emit.update(dto(id));
  emit.changed();
}

/**
 * A Central vai fechar (atualização ou saída): pausa quem está rodando e encerra o processo do Claude (e os estagiários
 * dele) antes de sair. No Windows o processo sobreviveria à Central e, ao reabrir, a retomada rodaria em paralelo com ele
 * na mesma sessão e na mesma pasta. Pausada, ela volta sozinha na mesma sessão quando a Central abrir.
 */
export function pauseAllOnQuit(): void {
  for (const { id, session_id } of all<{ id: number; session_id: string | null }>(`select id, session_id from runs where status in ('preparing','running')`)) {
    const reason = 'a Central fechou (atualização ou saída)';
    run(`update runs set status = 'queued', paused = ?, resume = ? where id = ?`, JSON.stringify({ reason, until: null, at: now() }), session_id ? reason : null, id);
    run('insert into run_events (run_id, at, kind, text) values (?,?,?,?)', id, now(), 'system', 'A Central fechou: pausada, volta sozinha na mesma sessão quando ela abrir.');
    const pid = procs.get(id)?.pid;
    procs.delete(id);
    if (pid) { try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* já saiu */ } }
  }
}

/** "Retomar agora": tira a pausa; começa assim que o freio e as vagas deixarem. */
export function unpauseRun(id: number, emit: Emit): void {
  const r = dto(id);
  if (r.status !== 'queued' || !r.paused) throw new Error('Essa execução não está pausada.');
  run('update runs set paused = null where id = ?', id);
  event(id, 'system', 'Retomada por você.', emit);
  emit.update(dto(id));
  pump(emit);
}

/**
 * Passa o trabalho de uma execução parada (pausada, falhou, interrompida) para outro agente (ou o mesmo, do zero):
 * mesma branch, com o registro de construção. Só um por vez em cada branch.
 */
export function handoffRun(oldId: number, agentId: number | null, note: string | null, emit: Emit): RunDto {
  const o = dto(oldId);
  if (['preparing', 'running'].includes(o.status)) throw new Error('Essa execução ainda está rodando: pare ou espere pausar antes de passar adiante.');
  if (o.status === 'queued' && !o.paused) throw new Error('Essa execução ainda não começou.');
  if (get(`select 1 from runs where handoff_from = ? and status in ('queued','preparing','running')`, oldId)) throw new Error('Alguém já está assumindo esse trabalho.');
  if (o.status === 'queued') {
    run(`update runs set status = 'killed', paused = null, resume = null, finished_at = ?, result = ? where id = ?`, now(), 'Passado para outro agente.', oldId);
    emit.update(dto(oldId));
  }
  const id = queueRun({
    project_slug: o.project_slug, agent_id: agentId ?? o.agent_id, repo_path: o.scope === 'repo' ? o.repo_path : null,
    prompt: note?.trim() ? `${o.prompt}\n\nObservação de quem passou: ${note.trim()}` : o.prompt,
    budget_usd: o.budget_usd, permission: o.permission, proposal_id: null, task_id: o.task_id,
    stage: o.stage ?? null, board_id: o.board_id ?? null, handoff_from: oldId, urgent: o.priority === 0,
  }, null);
  emit.changed();
  pump(emit);
  return dto(id);
}

/** O que quem assume precisa saber: como a outra execução parou, o plano, a última etapa, commits e mudanças. */
async function handoffBlock(o: RunDto, cwd: string): Promise<string> {
  const who = o.agent_id ? getAgent(o.agent_id)?.name ?? 'outro agente' : 'outro agente';
  const cp = o.checkpoint ? JSON.parse(o.checkpoint) as { plan: { title: string; status: string }[]; status: { phase: string; doing: string } | null } : null;
  const why = o.paused ? (JSON.parse(o.paused) as { reason: string }).reason : o.result?.slice(0, 300) ?? o.status;
  const commits = o.base_branch ? (await gitOr(cwd, ['log', '--oneline', `origin/${o.base_branch}..HEAD`], '')).trim() : '';
  const dirty = o.scope === 'repo' ? (await gitOr(cwd, ['status', '--short'], '')).trim() : '';
  const steps = all<{ kind: string; text: string }>(`select kind, text from run_events where run_id = ? and kind in ('tool','text') order by id desc limit 12`, o.id).reverse();
  return `## Você está assumindo o trabalho de ${who} (execução #${o.id})
Ela parou: ${why}. Continue de onde parou; não recomece do zero nem desfaça o que está certo.
${cp?.plan.length ? `\nPlano dela:\n${cp.plan.map(p => `- [${p.status === 'completed' ? 'x' : ' '}] ${p.title}`).join('\n')}\n` : ''}${cp?.status ? `\nÚltima etapa: ${cp.status.phase}, ${cp.status.doing}\n` : ''}${commits ? `\nCommits já feitos nesta branch:\n${commits}\n` : ''}${dirty ? `\nMudanças ainda sem commit (git status):\n${dirty}\n` : ''}${steps.length ? `\nÚltimos passos:\n${steps.map(e => `- ${e.text.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')}` : ''}`;
}

/**
 * Freio da cota, a cada 30 s: perto do limite pausa quem está rodando; depois que renova, retoma as pausadas uma por vez
 * (a mais prioritária primeiro, para não queimar a janela nova de uma vez) e põe a fila para andar.
 */
export function watchQuota(emit: Emit): void {
  setInterval(async () => {
    const u = readUsage((await getUsage(false).catch(() => ({ limits: usageNow() }))).limits);
    const stop = mustPause(u);
    if (stop) {
      for (const { id } of all<{ id: number }>(`select id from runs where status = 'running'`)) pauseRun(id, `cota: ${stop.reason}`, stop.until, emit);
    } else {
      const paused = all<{ id: number; priority: number; created_at: string; paused: string }>(
        `select id, priority, created_at, paused from runs where status = 'queued' and paused is not null`)
        .map(p => ({ ...p, until: (JSON.parse(p.paused) as { until: string | null }).until }));
      const next = nextToResume(paused, u, Date.now());
      if (next) { run('update runs set paused = null where id = ?', next); event(next, 'system', 'A cota deixou: retomando.', emit); }
    }
    pump(emit);
  }, 30_000);
}

type Where = { kind: 'repo'; branch: string; base: string } | { kind: 'project'; folder: string; repos: string[] } | { kind: 'workspace'; folder: string };

/**
 * Produção não é trava no código: cada agente tem nas instruções ou nas memórias o que pode subir (ex.: hotfix pequeno sim,
 * mudança crítica não). Sem isso, ou na dúvida, decide o Gustavo.
 */
const PROD_POLICY = 'Push direto em main, master ou develop e deploy em produção: só se as suas instruções de papel ou memórias permitirem para este tipo de atividade (ex.: hotfix pequeno). Se não permitirem, se for crítico ou se estiver em dúvida, crie uma decisão (create_decision) com o que vai subir, o risco e como desfazer, e espere.';

/** Projeto onde "pronto" é produção: o agente não dá a tarefa como feita no merge em develop. */
const prodRule = (slug: string | null) => (slug && get(`select 1 from projects where slug = ? and done_when = 'prod'`, slug)
  ? '\n- Neste projeto, pronto é em produção: merge em develop não fecha a tarefa. A Central leva para "Em dev" e depois para\n  Feito sozinha quando chegar em main. Não marque como feita.'
  : '');

function framePrompt(r: RunDto, where: Where): string {
  const task = r.task_id ? get<{ id: number; title: string }>('select id, title from tasks where id = ?', r.task_id) : null;
  const central = `## Central
Você tem as ferramentas \`central\` (MCP) da Central do Gustavo, onde vivem projetos, backlog, ideias e decisões. Use-as para deixar o backlog verdadeiro:
${task ? `- Esta execução é a tarefa #${task.id} ("${task.title}"). Não mova essa tarefa: a Central faz isso quando você terminar.\n` : ''}- O que ficou faltando ou o que você descobriu e vale fazer: crie tarefa no backlog ${r.project_slug ? `do projeto "${r.project_slug}"` : 'do projeto certo'} (create_task, coluna backlog) ou ideia (create_idea).
- O que depende de uma decisão do Gustavo: crie uma decisão (create_decision) com o próximo passo sugerido.
- Não exclua nada pela Central.
- Comece declarando seu plano na lista de tarefas (TaskCreate, 3 a 6 passos) e marque cada um (TaskUpdate) ao avançar:
  é assim que o Gustavo vê para onde você está indo.
- Ao começar cada etapa, chame set_status (fase + o que, curto${task ? `, task_id ${task.id}` : ''}): é o quadro que o Gustavo olha.
- Faltou algo que só o Gustavo resolve (sessão AWS/SSO expirada, gh sem login, credencial, VPN, acesso)? Não contorne nem
  desista: chame need_gustavo (o que falta, o que ele faz e o comando, ex.: aws sso login --profile X) e termine. A Central te
  retoma de onde parou quando ele resolver.
- Escolha que depende do Gustavo (qual caminho seguir, se pode mergear, se tira ou mantém): crie uma decisão com
  create_decision${task ? ` e task_id ${task.id}` : ' e o task_id da tarefa'}, com as opções no texto e o que você faz em cada uma. Não escreva escolhas
  pendentes na descrição da tarefa: a tarefa espera, e quando ele decidir a resposta volta para ela e você segue.${prodRule(r.project_slug)}
- Precisa de outro agente (ex.: achou um bug urgente que é de quem cuida do código ou da monitoração)? notify_agent com um
  resumo seu do que viu e do que precisa (não cole texto de cliente ou de fora), urgent só se for mesmo. Os agentes estão em list_agents.
- Antes de terminar, chame report_delivery: o que mudou, por quê, como testar em 1 minuto e o que ficou de risco.
  É o que o Gustavo lê quando volta; sem isso ele não sabe o que você fez.`;

  if (where.kind === 'workspace') {
    return `Você é um agente da Central trabalhando sozinho, sem ninguém para responder perguntas.

Você não está preso a um projeto. Sua pasta de trabalho é ${where.folder}: pode criar e editar arquivos lá (rascunhos, relatórios, notas).
Use as ferramentas da Central para conhecer os projetos.

## Tarefa
${r.prompt}

${central}

Termine com um resumo curto em português do que fez, dos arquivos que criou e do que registrou na Central.`;
  }
  if (where.kind === 'project') {
    return `Você é um agente da Central trabalhando sozinho, sem ninguém para responder perguntas.

Você está na pasta do projeto "${r.project_slug}" (${where.folder}), que contém estes repositórios: ${where.repos.join(', ') || 'nenhum'}.
${r.permission === 'edits'
    ? 'Modo seguro: você só pode ler e analisar. Não altere arquivos. Seu resultado vai para a Central (backlog, ideias, decisões) e para o resumo final.'
    : `Você pode alterar arquivos diretamente nas pastas, sem worktree isolada. Cuidado: as mudanças caem nas branches que estiverem em uso. ${PROD_POLICY}`}

## Tarefa
${r.prompt}

${central}

Termine com um resumo curto em português do que encontrou ou fez e do que registrou na Central.`;
  }
  return `Você é um agente da Central trabalhando sozinho, sem ninguém para responder perguntas.

Repositório: ${r.repo_name}. Você está numa git worktree isolada, na branch \`${where.branch}\`, criada a partir de \`${where.base}\`.

## Tarefa
${r.prompt}

## Regras
- Trabalhe nesta branch. ${PROD_POLICY}
- Leia o CLAUDE.md do repositório, se existir, e siga as convenções dele.
- Rode build/testes que existirem antes de concluir.
- Ao terminar: faça commit, \`git push -u origin ${where.branch}\` e abra um PR draft com \`gh pr create --draft --base ${where.base}\`.
- Se não for possível concluir, explique exatamente o que falta.

${central}

Termine com um resumo curto em português do que mudou, como verificar e o link do PR.`;
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
