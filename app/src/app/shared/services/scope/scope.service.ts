import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import { ProjectsService } from '../projects/projects.service';

/** telas que respeitam o projeto escolhido na barra lateral (as outras abrem a página do projeto) */
export const SCOPED = new Set(['/triagem', '/ideias', '/revisao', '/backlog', '/quadros', '/escritorio', '/agentes', '/execucoes', '/rotinas']);

/**
 * Escopo de projeto: o projeto escolhido na barra lateral filtra a tela atual. A URL manda (?projeto=), então
 * links, voltar/avançar e atalhos continuam valendo; escolher um grupo inclui as frentes dele.
 */
@Injectable({ providedIn: 'root' })
export class ScopeService {
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectsService);

  private readonly url = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  readonly path = computed(() => this.url().split(/[?#]/)[0] || '/');
  readonly scopable = computed(() => SCOPED.has(this.path()));
  /** projeto valendo na tela atual (null = todos) */
  readonly slug = computed(() => (this.scopable() ? this.router.parseUrl(this.url()).queryParamMap.get('projeto') || null : null));
  readonly project = computed(() => (this.slug() ? this.projects.bySlug().get(this.slug()!) ?? null : null));
  /** o último escopo escolhido: acompanha você ao trocar de tela pela barra de ícones */
  readonly sticky = signal<string | null>(null);

  constructor() {
    effect(() => { if (this.scopable()) this.sticky.set(this.slug()); });
  }

  /** marca da tela aberta em cada projeto da barra lateral (ex.: na Revisão, quantos itens esperam em cada um) */
  readonly marks = signal<ProjectMarks | null>(null);

  /** a coisa (de um projeto ou frente) entra no escopo? sem escopo, tudo entra */
  matches(slug: string | null | undefined): boolean {
    const s = this.slug();
    if (!s) return true;
    return !!slug && (slug === s || this.projects.bySlug().get(slug)?.parentSlug === s);
  }

  set(slug: string | null): void {
    this.router.navigate([], { queryParams: { projeto: slug, agente: null }, queryParamsHandling: 'merge' });
  }

  /** link da barra de ícones: leva o escopo junto para as telas que o respeitam */
  queryFor(path: string): Record<string, string> | null {
    const s = this.sticky();
    return s && SCOPED.has(path) ? { projeto: s } : null;
  }
}

export interface ProjectMarks {
  counts: ReadonlyMap<string, number>;
  /** classes do selo (cor) */
  tone: string;
  /** o que o número quer dizer ("para revisar") */
  label: string;
}

/**
 * Marca os projetos da barra lateral enquanto a tela está aberta. Chame no construtor (ou num campo) da tela:
 * `markProjects(() => itens.map(i => i.projectSlug), 'bg-frost text-night', 'para revisar')`. Some sozinha ao sair.
 */
export function markProjects(slugs: () => (string | null | undefined)[], tone: string, label: string): void {
  const scope = inject(ScopeService);
  const mine = { current: null as ProjectMarks | null };
  effect(() => {
    const counts = new Map<string, number>();
    for (const s of slugs()) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    mine.current = { counts, tone, label };
    scope.marks.set(mine.current);
  });
  inject(DestroyRef).onDestroy(() => { if (scope.marks() === mine.current) scope.marks.set(null); });
}
