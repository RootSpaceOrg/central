import { Injectable, computed, inject, signal } from '@angular/core';

import { RunDto, RunEventDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { RunsApiService } from './runs-api.service';
import { NewRun, Run, RunEvent, isActive } from './runs.model';

const toRun = (d: RunDto): Run => ({
  id: d.id,
  projectSlug: d.project_slug,
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
});

const toEvent = (d: RunEventDto): RunEvent => ({ at: new Date(d.at), kind: d.kind, text: d.text });

@Injectable({ providedIn: 'root' })
export class RunsService {
  private readonly api = inject(RunsApiService);

  readonly runs = signal<Run[]>([]);
  readonly active = computed(() => this.runs().filter(r => isActive(r.status)));
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
        project_slug: r.projectSlug, repo_path: r.repoPath, prompt: r.prompt,
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
}
