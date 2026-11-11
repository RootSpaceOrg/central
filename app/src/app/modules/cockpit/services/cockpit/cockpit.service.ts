import { Injectable, inject, signal } from '@angular/core';

import { CockpitDto, CockpitProduct } from '../../../../shared/contract';
import { CockpitApiService } from './cockpit-api.service';

export type OwnerState = CockpitProduct['owner_state'];

export interface Instrument {
  slug: string; name: string; color: string; iconKind: string; iconValue: string | null; parentSlug: string | null;
  owner: { id: number; name: string; color: string; iconKind: string; iconValue: string | null } | null;
  ownerOn: boolean; ownerState: OwnerState;
  focus: string | null;
  /** pct null = marco sem tarefas ligadas ainda */
  milestone: { title: string; target: string | null; total: number; done: number; pct: number | null } | null;
  rhythm: { days: number[]; delivered: number; validated: number; returned: number };
  metrics: { name: string; unit: string | null; value: number | null; prev: number | null; target: number | null; at: Date | null; everyHours: number | null }[];
  alerts: { id: number; summary: string; at: Date }[];
  returned: number; toValidate: number; decisions: number; activeRuns: number; storiesOpen: number;
  oneOnOne: { why: string; at: Date | null } | null;
  guideOpen: number | null;
  diary: { text: string | null; at: Date } | null;
}
export interface Company { slug: string; name: string; color: string; iconKind: string; iconValue: string | null; products: Instrument[] }

const utc = (s: string) => new Date(s.endsWith('Z') ? s : `${s}Z`);
const toInstrument = (p: CockpitProduct): Instrument => ({
  slug: p.slug, name: p.name, color: p.color, iconKind: p.icon_kind, iconValue: p.icon_value, parentSlug: p.parent_slug,
  owner: p.owner ? { id: p.owner.id, name: p.owner.name, color: p.owner.color, iconKind: p.owner.icon_kind, iconValue: p.owner.icon_value } : null,
  ownerOn: p.owner_on, ownerState: p.owner_state, focus: p.focus,
  milestone: p.milestone ? { ...p.milestone, pct: p.milestone.total ? Math.round((p.milestone.done / p.milestone.total) * 100) : null } : null,
  rhythm: { days: p.rhythm.days, delivered: p.rhythm.delivered_7d, validated: p.rhythm.validated_7d, returned: p.rhythm.returned_7d },
  metrics: p.metrics.map(m => ({ name: m.name, unit: m.unit, value: m.value, prev: m.prev, target: m.target, at: m.at ? utc(m.at) : null, everyHours: m.every_hours })),
  alerts: p.alerts.map(a => ({ id: a.id, summary: a.summary, at: utc(a.at) })),
  returned: p.returned, toValidate: p.to_validate, decisions: p.decisions, activeRuns: p.active_runs, storiesOpen: p.stories_open,
  oneOnOne: p.one_on_one ? { why: p.one_on_one.why, at: p.one_on_one.at ? utc(p.one_on_one.at) : null } : null,
  guideOpen: p.guide_open,
  diary: p.diary ? { text: p.diary.text, at: utc(p.diary.at) } : null,
});
const toCompanies = (d: CockpitDto): Company[] => d.companies.map(c => ({
  slug: c.slug, name: c.name, color: c.color, iconKind: c.icon_kind, iconValue: c.icon_value, products: c.products.map(toInstrument),
}));

/** os instrumentos de todos os produtos, por empresa; recarrega quando algo muda (com um respiro para não martelar) */
@Injectable({ providedIn: 'root' })
export class CockpitService {
  private readonly api = inject(CockpitApiService);
  readonly companies = signal<Company[]>([]);
  readonly loaded = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.api.onChanged(() => this.soon());
    this.load();
  }

  load(): void {
    this.api.get().then(d => { this.companies.set(toCompanies(d)); this.loaded.set(true); }, () => {});
  }

  /** muitas mudanças seguidas (agentes trabalhando): uma recarga só */
  soon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.load(); }, 1500);
  }

  async resolveAlert(id: number): Promise<void> { await this.api.resolveAlert(id); this.load(); }
}
