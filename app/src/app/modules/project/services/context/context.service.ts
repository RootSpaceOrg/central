import { Injectable, inject, signal } from '@angular/core';

import { CodeHitDto, ContextStatusDto, FactDto, FactKind, GraphDto, NodeDetailDto } from '../../../../shared/contract';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ContextApiService } from './context-api.service';

export type { CodeHitDto as CodeHit, GraphDto as CodeGraph, NodeDetailDto as NodeDetail, FactKind };

export interface IndexStatus { files: number; nodes: number; edges: number; indexedAt: Date | null; ms: number | null; error: string | null; indexing: boolean; done: number; total: number }
export interface Fact {
  id: number; kind: FactKind; text: string; source: string; author: string; pinned: boolean; retired: boolean; createdAt: Date; links: string[];
}

export const FACT_LABEL: Record<FactKind, string> = { decision: 'Decisão', convention: 'Convenção', gotcha: 'Armadilha', fact: 'Fato', howto: 'Como fazer' };

const toStatus = (d: ContextStatusDto): IndexStatus => ({
  files: d.files, nodes: d.nodes, edges: d.edges, indexedAt: d.indexed_at ? new Date(d.indexed_at) : null, ms: d.ms, error: d.error,
  indexing: d.indexing, done: d.done, total: d.total,
});
export const toFact = (d: FactDto): Fact => ({
  id: d.id, kind: d.kind, text: d.text, source: d.source_kind, author: d.author, pinned: d.pinned, retired: d.status === 'retired',
  createdAt: new Date(d.created_at), links: d.links,
});

/** Índice de código, grafo e memória de um projeto (a aba Contexto). */
@Injectable({ providedIn: 'root' })
export class ContextService {
  private readonly api = inject(ContextApiService);

  readonly status = signal<Record<string, IndexStatus>>({});
  readonly error = signal<string | null>(null);
  /** avisa a tela quando o índice ou a memória do projeto mudou */
  readonly version = signal<Record<string, number>>({});

  constructor() {
    this.loadStatus();
    this.api.onChanged(({ project }) => {
      this.loadStatus();
      this.version.update(v => ({ ...v, [project]: (v[project] ?? 0) + 1 }));
    });
  }

  loadStatus(): void {
    this.api.status().then(list => this.status.set(Object.fromEntries(list.map(s => [s.project, toStatus(s)]))));
  }

  reindex(slug: string, force = false): void { this.api.reindex(slug, force).then(() => this.loadStatus()); }
  graph(slug: string) { return this.api.graph(slug); }
  node(key: string) { return this.api.node(key); }
  search(slug: string, q: string) { return this.api.search(slug, q); }
  block(slug: string, focus: string, budget: number) { return this.api.block(slug, focus, budget); }

  async facts(slug: string): Promise<Fact[]> { return (await this.api.facts(slug)).map(toFact); }

  async remember(slug: string, kind: FactKind, text: string, links: string[] = [], pinned = false): Promise<void> {
    try { await this.api.createFact({ project_slug: slug, kind, text, links, pinned }); }
    catch (e) { throw new Error(errorMessage(e)); }
  }

  updateFact(id: number, patch: { text?: string; kind?: FactKind; pinned?: boolean; links?: string[] }) { return this.api.updateFact(id, patch); }
  retire(id: number, reason: string, replacement: string | null = null) { return this.api.supersede(id, reason, replacement); }
  deleteFact(id: number) { return this.api.deleteFact(id); }
  importMemory(slug: string) { return this.api.importMemory(slug); }
}
