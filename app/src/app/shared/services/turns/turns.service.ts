import { Injectable, computed, inject, signal } from '@angular/core';

import { RunPermission, TurnDto, TurnStatus } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { TurnsApiService } from './turns-api.service';

export interface Turn {
  id: number;
  projectSlug: string;
  until: Date;
  budgetUsd: number;
  status: TurnStatus;
  createdAt: Date;
  finishedAt: Date | null;
  runs: number;
  succeeded: number;
  failed: number;
  prs: number;
  costUsd: number;
}

const toModel = (d: TurnDto): Turn => ({
  id: d.id, projectSlug: d.project_slug, until: new Date(d.until), budgetUsd: d.budget_usd, status: d.status,
  createdAt: new Date(d.created_at), finishedAt: d.finished_at ? new Date(d.finished_at) : null,
  runs: d.runs, succeeded: d.succeeded, failed: d.failed, prs: d.prs, costUsd: d.cost_usd,
});

/** Turnos: "deixa X evoluindo até tal hora". */
@Injectable({ providedIn: 'root' })
export class TurnsService {
  private readonly api = inject(TurnsApiService);

  readonly turns = signal<Turn[]>([]);
  readonly running = computed(() => this.turns().filter(t => t.status === 'running'));

  constructor() {
    this.api.onChanged(() => this.load());
    this.load();
  }

  load(): void {
    this.api.list().then(list => this.turns.set(list.map(toModel)));
  }

  async start(projectSlug: string, items: { taskId: number; repoPath: string }[], until: Date, budgetUsd: number, permission: RunPermission): Promise<void> {
    try {
      await this.api.start({
        project_slug: projectSlug, items: items.map(i => ({ task_id: i.taskId, repo_path: i.repoPath })),
        until: until.toISOString(), budget_usd: budgetUsd, permission,
      });
      this.load();
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  stop(id: number): void {
    this.api.stop(id).then(() => this.load());
  }
}
