import { Injectable, inject, signal } from '@angular/core';

import { PrFilter, PrItemDto } from '../../../../shared/contract';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { PrsApiService } from './prs-api.service';

export type { PrFilter };
export interface PullRequest {
  number: number; title: string; url: string; repo: string; repoName: string; author: string; bot: boolean;
  createdAt: Date; updatedAt: Date; draft: boolean; comments: number; labels: { name: string; color: string | null }[];
  checks: PrItemDto['checks']; review: PrItemDto['review']; head: string | null; base: string | null;
  additions: number | null; deletions: number | null; conflict: boolean;
  project: { slug: string; name: string } | null; task: { id: number; title: string } | null;
}

export const FILTERS: { id: PrFilter; label: string; hint: string }[] = [
  { id: 'created', label: 'Criados por você', hint: 'PRs abertos que você (ou os agentes, com a sua conta) abriram' },
  { id: 'review', label: 'Pedem sua revisão', hint: 'alguém pediu a sua revisão' },
  { id: 'assigned', label: 'Atribuídos a você', hint: 'você é o responsável' },
  { id: 'mentioned', label: 'Mencionam você', hint: 'você foi citado' },
  { id: 'involves', label: 'Todos que te envolvem', hint: 'qualquer um dos anteriores' },
];

const toModel = (d: PrItemDto): PullRequest => ({
  number: d.number, title: d.title, url: d.url, repo: d.repo, repoName: d.repo.split('/').pop() ?? d.repo, author: d.author, bot: d.bot,
  createdAt: new Date(d.created_at), updatedAt: new Date(d.updated_at), draft: d.draft, comments: d.comments, labels: d.labels,
  checks: d.checks, review: d.review, head: d.head, base: d.base, additions: d.additions, deletions: d.deletions, conflict: d.conflict,
  project: d.project, task: d.task,
});

/** os PRs abertos de cada filtro (como o inbox do GitHub), com quando foram buscados */
@Injectable({ providedIn: 'root' })
export class PrsService {
  private readonly api = inject(PrsApiService);
  readonly byFilter = signal<Partial<Record<PrFilter, PullRequest[]>>>({});
  readonly loading = signal<PrFilter | null>(null);
  readonly error = signal<string | null>(null);
  readonly fetchedAt = signal<Date | null>(null);

  /** manda os PRs para o tech lead de cada projeto (analisar e mergear, ajustar e mergear, ou fechar) */
  delegate(urls: string[]) { return this.api.delegate(urls); }

  async load(filter: PrFilter, fresh = false): Promise<void> {
    this.loading.set(filter);
    this.error.set(null);
    try {
      const list = (await this.api.list(filter, fresh)).map(toModel);
      this.byFilter.update(m => ({ ...m, [filter]: list }));
      this.fetchedAt.set(new Date());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(null);
    }
  }
}
