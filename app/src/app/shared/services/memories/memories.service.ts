import { Injectable, inject, signal } from '@angular/core';

import { MemoryDto, MemoryKind } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { MemoriesApiService } from './memories-api.service';

export type { MemoryKind };

/** O que um agente lembra (agentId) ou o que todos lembram (agentId null). */
export interface Memory {
  id: number;
  agentId: number | null;
  kind: MemoryKind;
  text: string;
  /** 'gustavo' ou 'agente' */
  author: string;
  source: string | null;
  pinned: boolean;
  retired: boolean;
  createdAt: Date;
  retiredAt: Date | null;
  retiredReason: string | null;
}

export const MEMORY_KINDS: { id: MemoryKind; label: string; hint: string }[] = [
  { id: 'preferencia', label: 'Preferência', hint: 'como o Gustavo gosta das coisas' },
  { id: 'pessoa', label: 'Pessoa', hint: 'cliente, sócio, quem é quem' },
  { id: 'decisao', label: 'Decisão', hint: 'algo decidido que vale além de um projeto' },
  { id: 'como_fazer', label: 'Como fazer', hint: 'um jeito de trabalhar' },
  { id: 'fato', label: 'Fato', hint: 'qualquer outra coisa durável' },
];

const toModel = (d: MemoryDto): Memory => ({
  id: d.id, agentId: d.agent_id, kind: d.kind, text: d.text, author: d.author, source: d.source, pinned: d.pinned,
  retired: d.status === 'retired', createdAt: new Date(d.created_at), retiredAt: d.retired_at ? new Date(d.retired_at) : null,
  retiredReason: d.retired_reason,
});

/** Memória dos agentes (todas, inclusive esquecidas: são poucas e a tela filtra). */
@Injectable({ providedIn: 'root' })
export class MemoriesService {
  private readonly api = inject(MemoriesApiService);

  readonly all = signal<Memory[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    this.load();
    this.api.onChanged(() => this.load());
  }

  load(): void { this.api.list('all', true).then(list => this.all.set(list.map(toModel))); }

  /** ativas de um agente; null = as de todos */
  of(agentId: number | null): Memory[] { return this.all().filter(m => !m.retired && m.agentId === agentId); }
  /** esquecidas (do agente e as de todos) */
  retiredFor(agentId: number): Memory[] { return this.all().filter(m => m.retired && (m.agentId === agentId || m.agentId === null)); }

  async create(agentId: number | null, kind: MemoryKind, text: string): Promise<void> {
    try { await this.api.create({ agent_id: agentId, kind, text }); this.load(); }
    catch (e) { throw new Error(errorMessage(e)); }
  }

  update(id: number, patch: { text?: string; kind?: MemoryKind; pinned?: boolean; agentId?: number | null }): void {
    const { agentId, ...rest } = patch;
    this.all.update(l => l.map(m => (m.id === id ? { ...m, ...patch, agentId: agentId === undefined ? m.agentId : agentId } : m)));
    this.api.update(id, { ...rest, ...(agentId !== undefined ? { agent_id: agentId } : {}) }).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  forget(id: number, reason: string): void {
    this.api.forget(id, reason).then(() => this.load()).catch(e => this.error.set(errorMessage(e)));
  }

  remove(id: number): void {
    this.all.update(l => l.filter(m => m.id !== id));
    this.api.remove(id).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }
}
