import { Injectable, inject, signal } from '@angular/core';

import { PulseDto } from '../../../../shared/contract';
import { PulseApiService } from './pulse-api.service';

export interface Metric { name: string; value: number; unit: string | null; at: Date; note: string | null; prev: number | null }
export interface ProjectPulse {
  slug: string; name: string; color: string; owner: string | null; ownerOn: boolean;
  validated: number; returned: number; storiesOpen: number; lastPassAt: Date | null; metrics: Metric[];
  focus: string | null; diary: string | null; toValidate: number;
}
export interface Pulse { validated: number; returned: number; projects: ProjectPulse[] }

const utc = (s: string) => new Date(s.endsWith('Z') ? s : `${s}Z`);
const toModel = (d: PulseDto): Pulse => ({
  validated: d.validated, returned: d.returned,
  projects: d.projects.map(p => ({
    slug: p.slug, name: p.name, color: p.color, owner: p.owner, ownerOn: p.owner_on, validated: p.validated, returned: p.returned,
    storiesOpen: p.stories_open, focus: p.focus, diary: p.diary, toValidate: p.to_validate, lastPassAt: p.last_pass_at ? utc(p.last_pass_at) : null,
    metrics: p.metrics.map(m => ({ name: m.name, value: m.value, unit: m.unit, at: utc(m.at), note: m.note, prev: m.prev })),
  })),
});

/** a semana da Central: histórias validadas/devolvidas e o resultado de cada produto */
@Injectable({ providedIn: 'root' })
export class PulseService {
  private readonly api = inject(PulseApiService);
  readonly pulse = signal<Pulse | null>(null);

  load(): void { this.api.get().then(d => this.pulse.set(toModel(d)), () => {}); }
}
