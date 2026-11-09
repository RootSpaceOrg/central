import { Injectable, inject, signal } from '@angular/core';

import { ReleaseRepoDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { ReleaseApiService } from './release-api.service';

/** Um PR (ou commit direto) que está em develop e ainda não foi para produção. */
export interface ReleaseItem {
  sha: string;
  at: Date;
  author: string;
  title: string;
  pr: number | null;
  url: string | null;
  /** nota de entrega do agente, quando veio de uma execução */
  delivery: string | null;
  taskId: number | null;
}

export interface ReleaseRepo {
  path: string;
  name: string;
  prod: string | null;
  dev: string | null;
  commits: number;
  items: ReleaseItem[];
  oldestAt: Date | null;
  error: string | null;
  /** página no GitHub */
  url: string | null;
}

const toRepo = (d: ReleaseRepoDto): ReleaseRepo => ({
  path: d.path, name: d.name, prod: d.prod, dev: d.dev, commits: d.commits, error: d.error, url: d.url ?? null,
  oldestAt: d.oldest_at ? new Date(d.oldest_at) : null,
  items: d.items.map(i => ({ sha: i.sha, at: new Date(i.at), author: i.author, title: i.title, pr: i.pr, url: i.url, delivery: i.delivery, taskId: i.task_id })),
});

/** O que está em develop esperando ir para produção, por projeto e repositório. */
@Injectable({ providedIn: 'root' })
export class ReleaseService {
  private readonly api = inject(ReleaseApiService);

  /** por projeto (a Visão geral carrega todos; a aba do projeto atualiza o dele) */
  readonly bySlug = signal<Record<string, ReleaseRepo[]>>({});
  readonly loading = signal<Record<string, boolean>>({});
  readonly error = signal<string | null>(null);

  async load(slug: string, refresh = false): Promise<void> {
    this.loading.update(m => ({ ...m, [slug]: true }));
    try {
      const repos = (await this.api.status(slug, refresh)).map(toRepo);
      this.bySlug.update(m => ({ ...m, [slug]: repos }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.update(m => ({ ...m, [slug]: false }));
    }
  }

  async loadAll(): Promise<void> {
    try {
      const all = await this.api.summary();
      this.bySlug.set(Object.fromEntries(all.map(p => [p.slug, p.repos.map(toRepo)])));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
