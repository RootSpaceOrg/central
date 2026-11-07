import { Injectable, computed, inject, signal } from '@angular/core';

import { RunDto, RunEventDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { RunsApiService } from './runs-api.service';
import { NewRun, Run, RunEvent, isActive } from './runs.model';

const toRun = (d: RunDto): Run => ({
  id: d.id,
  projectSlug: d.project_slug,
  agentId: d.agent_id,
  sessionId: d.session_id,
  proposalId: d.proposal_id,
  taskId: d.task_id,
  turnId: d.turn_id,
  routineId: d.routine_id,
  scope: d.scope ?? 'repo',
  repoPath: d.repo_path,
  repoName: d.repo_name,
  worktreePath: d.worktree_path,
  branch: d.branch,
  baseBranch: d.base_branch,
  prompt: d.prompt,
  title: d.prompt.split('\n')[0].slice(0, 140),
  status: d.status,
  permission: d.permission,
  budgetUsd: d.budget_usd,
  costUsd: d.cost_usd,
  sessionUsed: d.usage_start != null && d.usage_end != null && d.usage_end >= d.usage_start ? Math.round(d.usage_end - d.usage_start) : null,
  prUrl: d.pr_url,
  result: d.result,
  createdAt: new Date(d.created_at),
  startedAt: d.started_at ? new Date(d.started_at) : null,
  finishedAt: d.finished_at ? new Date(d.finished_at) : null,
  waiting: parseWaiting(d.waiting),
  grants: (() => { try { return d.grants ? JSON.parse(d.grants) : []; } catch { return []; } })(),
  paused: parsePaused(d.paused),
  priority: d.priority ?? 1,
  parentRunId: d.parent_run_id ?? null,
  handoffFrom: d.handoff_from ?? null,
});

function parsePaused(raw: string | null | undefined): Run['paused'] {
  if (!raw) return null;
  try { const p = JSON.parse(raw); return { reason: String(p.reason ?? ''), until: p.until ? new Date(p.until) : null }; }
  catch { return null; }
}

function parseWaiting(raw: string | null | undefined): Run['waiting'] {
  if (!raw) return null;
  try { const w = JSON.parse(raw); return { reason: String(w.reason ?? ''), fix: String(w.fix ?? ''), command: w.command ? String(w.command) : null }; }
  catch { return null; }
}

const toEvent = (d: RunEventDto): RunEvent => ({ at: new Date(d.at), kind: d.kind, text: d.text });

@Injectable({ providedIn: 'root' })
export class RunsService {
  private readonly api = inject(RunsApiService);

  readonly runs = signal<Run[]>([]);
  /** trabalhando ou na fila para trabalhar (pausada pelo freio não conta: está esperando a cota) */
  readonly active = computed(() => this.runs().filter(r => isActive(r.status) && !r.paused));
  /** eventos por execução, só das que já foram abertas na tela */
  private readonly events = new Map<number, ReturnType<typeof signal<RunEvent[]>>>();

  constructor() {
    this.api.onUpdate(d => {
      const run = toRun(d);
      this.runs.update(list => (list.some(r => r.id === run.id) ? list.map(r => (r.id === run.id ? run : r)) : [run, ...list]));
    });
    this.api.onEvent(d => this.events.get(d.run_id)?.update(list => [...list, toEvent(d)]));
    this.load();
  }

  load(): void {
    this.api.list(null).then(list => this.runs.set(list.map(toRun)));
  }

  eventsOf(id: number) {
    let s = this.events.get(id);
    if (!s) {
      s = signal<RunEvent[]>([]);
      this.events.set(id, s);
      this.api.events(id).then(list => s!.set(list.map(toEvent)));
    }
    return s.asReadonly();
  }

  async start(r: NewRun): Promise<Run> {
    try {
      const run = toRun(await this.api.start({
        project_slug: r.projectSlug, agent_id: r.agentId ?? null, repo_path: r.repoPath, prompt: r.prompt,
        budget_usd: r.budgetUsd, permission: r.permission, proposal_id: r.proposalId, task_id: r.taskId,
      }));
      this.runs.update(list => [run, ...list.filter(x => x.id !== run.id)]);
      return run;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  kill(id: number): void {
    this.api.kill(id);
  }

  /** continua uma execução que falhou ou foi interrompida, na mesma sessão do Claude, de onde parou */
  async continue(id: number, note: string | null = null): Promise<void> {
    try { await this.api.continue(id, note); } catch (e) { throw new Error(errorMessage(e)); }
  }

  /** libera para o agente o que a execução pediu e continua de onde parou */
  async grant(id: number): Promise<void> {
    try { await this.api.grant(id); } catch (e) { throw new Error(errorMessage(e)); }
  }

  /** tira a pausa do freio (volta assim que a cota e as vagas deixarem) */
  unpause(id: number): Promise<void> { return this.api.unpause(id).catch(e => { throw new Error(errorMessage(e)); }); }

  /** outro agente (ou o mesmo, do zero) assume o trabalho parado, na mesma branch, com o registro do que foi feito */
  async handoff(id: number, agentId: number | null, note: string | null): Promise<Run> {
    try { return toRun(await this.api.handoff(id, agentId, note)); } catch (e) { throw new Error(errorMessage(e)); }
  }

  /** Execuções que pararam esperando você (já terminaram o processo). */
  readonly waiting = computed(() => this.runs().filter(r => r.waiting && r.finishedAt));

  /** Você resolveu: retoma a sessão da execução de onde parou. Devolve a conversa. */
  async resume(id: number, note: string | null = null): Promise<number> {
    try {
      const chatId = await this.api.resume(id, note);
      this.runs.update(list => list.map(r => (r.id === id ? { ...r, waiting: null } : r)));
      return chatId;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }
}
