import { Injectable, computed, inject, signal } from '@angular/core';

import { Idea } from '../ideas/ideas.service';
import { ProjectsService } from '../projects/projects.service';
import { Proposal } from '../proposals/proposals.model';
import { SettingsApiService } from '../settings/settings-api.service';

/** O que aparece na Triagem. Lista vazia = tudo daquele critério. */
export interface Focus {
  types: ('decision' | 'idea')[];
  /** slugs; '' = sem projeto. Um projeto inclui as frentes dele. */
  projects: string[];
  origins: ('agents' | 'mine')[];
  /** só o que tem agente parado esperando você */
  blocking: boolean;
}
export interface FocusMode { name: string; focus: Focus }

export const ALL: Focus = { types: [], projects: [], origins: [], blocking: false };
/** modos que já vêm prontos (não dá para apagar) */
export const BUILTIN: FocusMode[] = [
  { name: 'Tudo', focus: ALL },
  { name: 'Destravar agentes', focus: { ...ALL, types: ['decision'], blocking: true } },
];
const same = (a: Focus, b: Focus) => JSON.stringify(a) === JSON.stringify(b);

/** Decisão que trava um agente: é sobre uma tarefa (o responsável espera a resposta) ou veio de quem parou pedindo você. */
export const blocking = (p: Proposal) => p.taskId !== null || ['dispatch', 'atendimento', 'whatsapp'].includes(p.source);

/**
 * Foco da Triagem: você escolhe o que quer ver agora (tipo, projetos, origem, só bloqueios) e salva como modo.
 * Fica lembrado entre aberturas; o número no menu conta só o que está no foco.
 */
@Injectable({ providedIn: 'root' })
export class TriageFocusService {
  private readonly settings = inject(SettingsApiService);
  private readonly projects = inject(ProjectsService);

  readonly focus = signal<Focus>(ALL);
  readonly saved = signal<FocusMode[]>([]);
  readonly modes = computed(() => [...BUILTIN, ...this.saved()]);
  /** nome do modo que bate com o foco atual (null = personalizado) */
  readonly mode = computed(() => this.modes().find(m => same(m.focus, this.focus()))?.name ?? null);
  readonly filtering = computed(() => !same(this.focus(), ALL));

  constructor() {
    this.settings.get('triage:focus').then(v => { if (v) this.focus.set({ ...ALL, ...JSON.parse(v) }); });
    this.settings.get('triage:modes').then(v => { if (v) this.saved.set(JSON.parse(v)); });
  }

  set(f: Focus): void { this.focus.set(f); this.settings.set('triage:focus', JSON.stringify(f)); }
  patch(p: Partial<Focus>): void { this.set({ ...this.focus(), ...p }); }
  /** liga/desliga um valor de uma lista do foco */
  toggle<K extends 'types' | 'projects' | 'origins'>(key: K, value: Focus[K][number]): void {
    const list = this.focus()[key] as string[];
    this.patch({ [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] } as Partial<Focus>);
  }
  use(name: string): void { const m = this.modes().find(x => x.name === name); if (m) this.set(m.focus); }
  saveAs(name: string): void {
    const n = name.trim();
    if (!n || BUILTIN.some(b => b.name === n)) return;
    const list = [...this.saved().filter(m => m.name !== n), { name: n, focus: this.focus() }];
    this.saved.set(list);
    this.settings.set('triage:modes', JSON.stringify(list));
  }
  remove(name: string): void {
    const list = this.saved().filter(m => m.name !== name);
    this.saved.set(list);
    this.settings.set('triage:modes', JSON.stringify(list));
  }

  /** o projeto do item está no foco? (a frente conta como o projeto-pai) */
  private inProjects(slug: string | null): boolean {
    const f = this.focus().projects;
    if (!f.length) return true;
    if (!slug) return f.includes('');
    return f.includes(slug) || f.includes(this.projects.bySlug().get(slug)?.parentSlug ?? '\u0000');
  }

  decision(p: Proposal): boolean {
    const f = this.focus();
    if (f.types.length && !f.types.includes('decision')) return false;
    if (f.blocking && !blocking(p)) return false;
    if (f.origins.length && !f.origins.includes(['manual', 'memory'].includes(p.source) ? 'mine' : 'agents')) return false;
    return this.inProjects(p.projectSlug);
  }

  idea(i: Idea): boolean {
    const f = this.focus();
    if (f.types.length && !f.types.includes('idea')) return false;
    if (f.blocking) return false; // ideia não trava agente
    if (f.origins.length && !f.origins.includes(i.author === 'gustavo' ? 'mine' : 'agents')) return false;
    return this.inProjects(i.projectSlug);
  }
}
