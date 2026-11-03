import { Injectable, inject, signal } from '@angular/core';

import { ProposalDto } from '../../contract';
import { IpcService, errorMessage } from '../ipc/ipc.service';
import { ProposalsApiService } from './proposals-api.service';
import { Proposal, RiskTier, Verdict } from './proposals.model';

const toModel = (d: ProposalDto): Proposal => ({
  id: d.id,
  projectSlug: d.project_slug,
  title: d.title,
  body: d.body,
  tier: d.tier as RiskTier | null,
  attentionMin: d.est_attention_min,
  nextAction: d.next_action,
  status: d.status,
  source: d.source,
  createdAt: new Date(d.created_at),
  taskId: d.task_id ?? null,
});

@Injectable({ providedIn: 'root' })
export class ProposalsService {
  private readonly api = inject(ProposalsApiService);

  readonly inbox = signal<Proposal[]>([]);
  readonly approved = signal<Proposal[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    inject(IpcService).on('projects:changed', () => this.load());
    this.load();
  }

  load(): void {
    Promise.all([this.api.list(['proposed']), this.api.list(['approved', 'running'])])
      .then(([open, approved]) => {
        this.inbox.set(open.map(toModel));
        this.approved.set(approved.map(toModel));
        this.loaded.set(true);
      })
      .catch(e => this.error.set(errorMessage(e)));
  }

  decide(p: Proposal, verdict: Verdict): void {
    this.inbox.update(list => list.filter(x => x.id !== p.id));
    if (verdict === 'approve') this.approved.update(list => [{ ...p, status: 'approved' }, ...list]);
    this.api.decide(p.id, verdict, null).catch(e => {
      this.error.set(`A decisão não foi salva: ${errorMessage(e)}`);
      this.load();
    });
  }

  async create(title: string, body: string, projectSlug: string | null): Promise<void> {
    await this.api.create({ title, body: body || null, project_slug: projectSlug });
    this.load();
  }
}
