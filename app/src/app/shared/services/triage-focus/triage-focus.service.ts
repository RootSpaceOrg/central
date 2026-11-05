import { Injectable, inject, signal } from '@angular/core';

import { Idea } from '../ideas/ideas.service';
import { ProjectsService } from '../projects/projects.service';
import { Proposal } from '../proposals/proposals.model';
import { SettingsApiService } from '../settings/settings-api.service';

/** O que aparece na Triagem. Lista vazia = todos os projetos. */
export interface Focus {
  /** slugs; '' = sem projeto. Um projeto inclui as frentes dele. */
  projects: string[];
  /** só decisões com agente parado esperando você */
  blocking: boolean;
}
export type TriageTab = 'decision' | 'idea';

export const ALL: Focus = { projects: [], blocking: false };

/** Decisão que trava um agente: é sobre uma tarefa (o responsável espera a resposta) ou veio de quem parou pedindo você. */
export const blocking = (p: Proposal) => p.taskId !== null || ['dispatch', 'atendimento', 'whatsapp'].includes(p.source);

/**
 * Filtros da Triagem (projetos ligados, só o que trava), aba e colunas da grade. Ficam lembrados entre aberturas;
 * o número no menu conta só o que passa pelos filtros.
 */
@Injectable({ providedIn: 'root' })
export class TriageFocusService {
  private readonly settings = inject(SettingsApiService);
  private readonly projects = inject(ProjectsService);

  readonly focus = signal<Focus>(ALL);
  readonly tab = signal<TriageTab>('decision');
  readonly cols = signal<2 | 3>(3);

  constructor() {
    this.settings.get('triage:focus').then(v => {
      if (!v) return;
      const f = JSON.parse(v);
      this.focus.set({ projects: Array.isArray(f.projects) ? f.projects : [], blocking: !!f.blocking });
    });
    this.settings.get('triage:tab').then(v => { if (v === 'decision' || v === 'idea') this.tab.set(v); });
    this.settings.get('triage:cols').then(v => { if (v === '2') this.cols.set(2); });
  }

  set(f: Focus): void { this.focus.set(f); this.settings.set('triage:focus', JSON.stringify(f)); }
  toggleProject(slug: string): void {
    const l = this.focus().projects;
    this.set({ ...this.focus(), projects: l.includes(slug) ? l.filter(x => x !== slug) : [...l, slug] });
  }
  setTab(t: TriageTab): void { this.tab.set(t); this.settings.set('triage:tab', t); }
  setCols(n: 2 | 3): void { this.cols.set(n); this.settings.set('triage:cols', String(n)); }

  /** projeto-pai do item ('' = sem projeto): a frente conta como o projeto */
  top(slug: string | null): string { return slug ? this.projects.bySlug().get(slug)?.parentSlug ?? slug : ''; }

  private inProjects(slug: string | null, f: Focus): boolean { return !f.projects.length || f.projects.includes(this.top(slug)); }

  decision(p: Proposal, f = this.focus()): boolean { return (!f.blocking || blocking(p)) && this.inProjects(p.projectSlug, f); }
  /** "só travando" vale para decisões; ideias seguem só o filtro de projeto */
  idea(i: Idea, f = this.focus()): boolean { return this.inProjects(i.projectSlug, f); }
}
