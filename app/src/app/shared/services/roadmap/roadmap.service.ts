import { Injectable, computed, inject, signal } from '@angular/core';

import { Horizon, MilestoneDto, MilestoneInput } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { RoadmapApiService } from './roadmap-api.service';

export type { Horizon };
export interface Milestone {
  id: number; projectSlug: string; title: string; description: string | null; horizon: Horizon; target: string | null;
  position: number; doneAt: Date | null; tasks: number; tasksDone: number; ideas: number;
}

export const HORIZONS: { id: Horizon; label: string; hint: string }[] = [
  { id: 'now', label: 'Agora', hint: 'o que o time está empurrando' },
  { id: 'next', label: 'Próximo', hint: 'entra quando o de agora fechar' },
  { id: 'later', label: 'Depois', hint: 'no radar, sem compromisso' },
];

const toModel = (d: MilestoneDto): Milestone => ({
  id: d.id, projectSlug: d.project_slug, title: d.title, description: d.description, horizon: d.horizon, target: d.target,
  position: d.position, doneAt: d.done_at ? new Date(d.done_at) : null, tasks: d.tasks, tasksDone: d.tasks_done, ideas: d.ideas,
});

/** Roadmap de todos os projetos: marcos em Agora / Próximo / Depois / Feito, com progresso pelas tarefas ligadas. */
@Injectable({ providedIn: 'root' })
export class RoadmapService {
  private readonly api = inject(RoadmapApiService);

  readonly all = signal<Milestone[]>([]);
  readonly error = signal<string | null>(null);
  /** marcos em Agora de cada projeto (o "na parede" do escritório e do início) */
  readonly nowBySlug = computed(() => {
    const m = new Map<string, Milestone[]>();
    for (const x of this.all()) if (x.horizon === 'now') m.set(x.projectSlug, [...(m.get(x.projectSlug) ?? []), x]);
    return m;
  });

  constructor() {
    this.load();
    this.api.onChanged(() => this.load());
  }

  load(): void { this.api.list().then(list => this.all.set(list.map(toModel))); }

  of(slug: string, horizon?: Horizon): Milestone[] {
    return this.all().filter(m => m.projectSlug === slug && (!horizon || m.horizon === horizon)).sort((a, b) => a.position - b.position);
  }

  async create(slug: string, input: MilestoneInput): Promise<void> {
    try { await this.api.create(slug, input); this.load(); }
    catch (e) { throw new Error(errorMessage(e)); }
  }

  update(id: number, input: MilestoneInput): void {
    this.all.update(list => list.map(m => (m.id === id ? { ...m, ...(input as Partial<Milestone>) } : m)));
    this.api.update(id, input).then(() => this.load()).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  remove(id: number): void {
    this.all.update(list => list.filter(m => m.id !== id));
    this.api.remove(id).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  /** Arrastou: nova ordem (e talvez novo horizonte) de uma coluna. */
  reorder(ids: number[], horizon: Horizon): void {
    const pos = new Map(ids.map((id, i) => [id, i]));
    this.all.update(list => list.map(m => (pos.has(m.id) ? { ...m, horizon, position: pos.get(m.id)! } : m)));
    this.api.reorder(ids, horizon).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }
}
