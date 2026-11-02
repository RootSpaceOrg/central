import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { LiveActivityDto } from '../../contract';
import { IpcService } from '../ipc/ipc.service';
import { TerminalsService } from '../terminals/terminals.service';

export interface Subagent { id: string; type: string; description: string; startedAt: number; finishedAt: number | null; step: string | null; steps: number }
export interface LiveActivity { scope: 'chat' | 'run'; ref: number; startedAt: number; step: string | null; subagents: Subagent[] }

const toModel = (d: LiveActivityDto): LiveActivity => ({
  scope: d.scope, ref: d.ref, startedAt: Date.parse(d.started_at), step: d.step,
  subagents: d.subagents.map(s => ({ id: s.id, type: s.type, description: s.description, startedAt: Date.parse(s.started_at),
    finishedAt: s.finished_at ? Date.parse(s.finished_at) : null, step: s.step, steps: s.steps })),
});

/** "42s", "3:07", "1h12" */
export function elapsed(from: number, to: number): string {
  const s = Math.max(0, Math.floor((to - from) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

/**
 * O que está trabalhando agora: conversas e execuções (com subagentes), como no Orca. O relógio anda a cada segundo
 * só enquanto há algo rodando.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly ipc = inject(IpcService);

  readonly items = signal<ReadonlyMap<string, LiveActivity>>(new Map());
  /** relógio para os contadores (ms) */
  readonly now = signal(Date.now());
  /** outros "trabalhando" (terminais do Claude Code) pedem o relógio também */
  readonly extra = signal(0);
  private tick: ReturnType<typeof setInterval> | null = null;

  readonly chats = computed(() => [...this.items().values()].filter(a => a.scope === 'chat'));
  readonly runs = computed(() => [...this.items().values()].filter(a => a.scope === 'run'));

  private readonly terminals = inject(TerminalsService);
  /** terminais do Claude Code trabalhando (sessão → desde) */
  readonly terminalsBusy = computed(() => this.terminals.busy());

  constructor() {
    effect(() => { const n = this.terminals.busy().size; untracked(() => { this.extra.set(n); this.clock(); }); });
    this.ipc.invoke('activity:list').then(list => { this.items.set(new Map(list.map(d => [`${d.scope}:${d.ref}`, toModel(d)]))); this.clock(); });
    this.ipc.on('activity', ({ scope, ref, activity }) => {
      const m = new Map(this.items());
      if (activity) m.set(`${scope}:${ref}`, toModel(activity)); else m.delete(`${scope}:${ref}`);
      this.items.set(m);
      this.clock();
    });
  }

  chat(chatId: number | null): LiveActivity | null { return chatId ? this.items().get(`chat:${chatId}`) ?? null : null; }
  run(runId: number): LiveActivity | null { return this.items().get(`run:${runId}`) ?? null; }

  /** subagentes ainda rodando */
  running(a: LiveActivity | null): number { return a ? a.subagents.filter(s => !s.finishedAt).length : 0; }

  /** Liga/desliga o relógio conforme há algo rodando. */
  clock(): void {
    const busy = this.items().size > 0 || this.extra() > 0;
    if (busy && !this.tick) this.tick = setInterval(() => this.now.set(Date.now()), 1000);
    if (!busy && this.tick) { clearInterval(this.tick); this.tick = null; }
    this.now.set(Date.now());
  }

  since(from: number): string { return elapsed(from, this.now()); }
}
