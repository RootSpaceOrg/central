import { Injectable, computed, inject, signal } from '@angular/core';

import { GuideCard, GuideDto, GuidePlanItem, PilotDto } from '../../../../shared/contract';
import { IpcService, errorMessage } from '../../../../shared/services/ipc/ipc.service';

export type { GuideCard, GuidePlanItem };

/** retrato em números (montado no processo principal) */
export interface GuideSnapshot {
  project: string;
  scope: string;
  description: string | null;
  direction: { text: string; updated_at: string } | null;
  roadmap: { now: string[]; next: string[]; later: number; done_30d: number };
  tasks: Record<'backlog' | 'todo' | 'doing' | 'review' | 'dev' | 'done', number>;
  stuck_doing: string[];
  ideas: { new: number; approved_waiting: number };
  decisions_open: number;
  runs_7d: { succeeded: number; failed: number; active: number };
  review_waiting: number;
  waiting_production: { repo: string; commits: number; since: string | null }[];
}

export interface Guide {
  id: number;
  projectSlug: string;
  direct: boolean;
  status: GuideDto['status'];
  step: number;
  phase: string;
  snapshot: GuideSnapshot;
  reading: string | null;
  cards: GuideCard[];
  plan: GuidePlanItem[];
  centralChat: number | null;
  strategistChat: number | null;
  minutes: string | null;
  focus: string | null;
  kind: 'rumo' | 'agencia';
  createdAt: Date;
  approvedAt: Date | null;
  finishedAt: Date | null;
}

const json = <T>(v: string | null, d: T): T => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const toGuide = (d: GuideDto): Guide => ({
  id: d.id, projectSlug: d.project_slug, direct: !!d.direct, status: d.status, step: d.step, phase: d.phase,
  snapshot: json(d.snapshot, {} as GuideSnapshot), reading: d.reading, cards: json(d.cards, []), plan: json(d.plan, []),
  centralChat: d.central_chat, strategistChat: d.strategist_chat, minutes: d.minutes, focus: d.focus ?? null, kind: d.kind ?? 'rumo', createdAt: new Date(d.created_at),
  approvedAt: d.approved_at ? new Date(d.approved_at) : null, finishedAt: d.finished_at ? new Date(d.finished_at) : null,
});

export interface Pilot {
  id: number;
  projectSlug: string;
  direct: boolean;
  status: PilotDto['status'];
  stage: PilotDto['stage'];
  rumoGuide: number;
  timeGuide: number | null;
  focus: string | null;
  feedback: string | null;
  error: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  finishedAt: Date | null;
}
const toPilot = (d: PilotDto): Pilot => ({
  id: d.id, projectSlug: d.project_slug, direct: !!d.direct, status: d.status, stage: d.stage, rumoGuide: d.rumo_guide, timeGuide: d.time_guide,
  focus: d.focus, feedback: d.feedback, error: d.error, createdAt: new Date(d.created_at),
  approvedAt: d.approved_at ? new Date(d.approved_at) : null, finishedAt: d.finished_at ? new Date(d.finished_at) : null,
});

/** Guiar projeto: sessões (abertas e atas), e as ações de cada etapa. */
@Injectable({ providedIn: 'root' })
export class GuidesService {
  private readonly ipc = inject(IpcService);
  readonly guides = signal<Guide[]>([]);
  /** piloto automático (Rumo + Time sem você no meio) */
  readonly pilots = signal<Pilot[]>([]);
  readonly error = signal<string | null>(null);
  readonly open = computed(() => this.guides().filter(g => g.status === 'open'));

  constructor() {
    this.load();
    this.ipc.on('guides:changed', () => this.load());
  }

  load(): void {
    this.ipc.invoke('guides:list').then(l => this.guides.set(l.map(toGuide)));
    this.ipc.invoke('pilot:list').then(l => this.pilots.set(l.map(toPilot)));
  }

  /** piloto em andamento ou esperando você neste escopo */
  pilotFor(slug: string, direct: boolean): Pilot | null {
    return this.pilots().find(p => p.projectSlug === slug && p.direct === direct && ['running', 'ready', 'approved', 'failed'].includes(p.status)) ?? null;
  }
  guide(id: number | null): Guide | null { return id ? this.guides().find(g => g.id === id) ?? null : null; }
  pilotStart(slug: string, direct: boolean, focus: string | null) { return this.act(this.ipc.invoke('pilot:start', slug, direct, focus)); }
  pilotApprove(id: number) { return this.act(this.ipc.invoke('pilot:approve', id)); }
  pilotFeedback(id: number, text: string) { return this.act(this.ipc.invoke('pilot:feedback', id, text)); }
  pilotAbandon(id: number) { return this.act(this.ipc.invoke('pilot:abandon', id)); }

  /** sessão aberta deste escopo (projeto inteiro ou só o projeto direto) */
  openFor(slug: string, direct: boolean, kind: Guide['kind'] = 'rumo'): Guide | null { return this.open().find(g => g.projectSlug === slug && g.direct === direct && g.kind === kind) ?? null; }

  private async act<T>(p: Promise<T>): Promise<T | null> {
    this.error.set(null);
    try { const r = await p; this.load(); return r; } catch (e) { this.error.set(errorMessage(e)); return null; }
  }

  start(slug: string, direct: boolean, focus: string | null, kind: Guide['kind'] = 'rumo') { return this.act(this.ipc.invoke('guides:start', slug, direct, focus, kind)); }
  talk(id: number) { return this.act(this.ipc.invoke('guides:talk', id)); }
  team(slug: string, direct: boolean) { return this.ipc.invoke('agency:team', slug, direct); }
  routines(slug: string) { return this.ipc.invoke('agency:routines', slug); }
  setRoutines(slug: string, on: { daily: boolean; weekly: boolean }) { return this.act(this.ipc.invoke('agency:setRoutines', slug, on)); }
  focus(id: number, text: string) { return this.act(this.ipc.invoke('guides:focus', id, text)); }
  step(id: number, step: number) { this.guides.update(l => l.map(g => (g.id === id ? { ...g, step } : g))); return this.act(this.ipc.invoke('guides:step', id, step)); }
  answer(id: number, cardId: string, answer: GuideCard['answer']) {
    this.guides.update(l => l.map(g => (g.id === id ? { ...g, cards: g.cards.map(c => (c.id === cardId ? { ...c, answer } : c)) } : g)));
    return this.act(this.ipc.invoke('guides:answer', id, cardId, answer));
  }
  requestPlan(id: number) { return this.act(this.ipc.invoke('guides:plan', id)); }
  item(id: number, itemId: string, patch: Partial<Pick<GuidePlanItem, 'when' | 'include'>>) {
    this.guides.update(l => l.map(g => (g.id === id ? { ...g, plan: g.plan.map(p => (p.id === itemId ? { ...p, ...patch } : p)) } : g)));
    return this.act(this.ipc.invoke('guides:item', id, itemId, patch));
  }
  approve(id: number) { return this.act(this.ipc.invoke('guides:approve', id)); }
  ask(id: number, question: string) { return this.act(this.ipc.invoke('guides:ask', id, question)); }
  abandon(id: number) { return this.act(this.ipc.invoke('guides:abandon', id)); }
}
