import { Injectable, inject } from '@angular/core';

import { FactKind, NewFactInput } from '../../../../shared/contract';
import { IpcService } from '../../../../shared/services/ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class ContextApiService {
  private readonly ipc = inject(IpcService);

  status() { return this.ipc.invoke('context:status'); }
  reindex(slug: string, force: boolean) { return this.ipc.invoke('context:reindex', slug, force); }
  graph(slug: string) { return this.ipc.invoke('context:graph', slug); }
  node(key: string) { return this.ipc.invoke('context:node', key); }
  search(slug: string, q: string) { return this.ipc.invoke('context:search', slug, q); }
  block(slug: string, focus: string, budget: number) { return this.ipc.invoke('context:block', slug, focus, budget); }
  facts(slug: string) { return this.ipc.invoke('facts:list', slug); }
  createFact(input: NewFactInput) { return this.ipc.invoke('facts:create', input); }
  updateFact(id: number, patch: { text?: string; kind?: FactKind; pinned?: boolean; links?: string[] }) { return this.ipc.invoke('facts:update', id, patch); }
  supersede(id: number, reason: string, replacement: string | null) { return this.ipc.invoke('facts:supersede', id, reason, replacement); }
  deleteFact(id: number) { return this.ipc.invoke('facts:delete', id); }
  importMemory(slug: string) { return this.ipc.invoke('facts:import', slug); }
  onChanged(cb: (e: { project: string }) => void) { return this.ipc.on('context:changed', cb); }
}
