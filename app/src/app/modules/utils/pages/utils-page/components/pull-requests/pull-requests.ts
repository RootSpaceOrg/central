import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';

import { DialogsService } from '../../../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { FILTERS, PrFilter, PrsService, PullRequest } from '../../../../services/prs/prs.service';

const REVIEW: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: 'Aprovado', tone: 'border-yes/40 text-yes' },
  CHANGES_REQUESTED: { label: 'Mudanças pedidas', tone: 'border-no/40 text-no' },
  REVIEW_REQUIRED: { label: 'Revisão pendente', tone: 'border-later/40 text-later' },
};

/**
 * Pull Requests abertos que envolvem você, como o inbox do GitHub: filtros à esquerda, busca, e cada PR com o estado do
 * CI, da revisão, conflito, tamanho e o projeto/tarefa da Central. Clique abre no GitHub.
 */
@Component({
  selector: 'app-pull-requests',
  imports: [AgoPipe, Icon],
  host: { class: 'grid min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-6' },
  template: `
    <!-- filtros -->
    <nav class="space-y-0.5" aria-label="Filtros de pull requests">
      @for (f of filters; track f.id) {
        <button type="button" (click)="filter.set(f.id)" [attr.aria-current]="filter() === f.id ? 'page' : null" [title]="f.hint"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors"
                [class]="filter() === f.id ? 'bg-frost/15 font-semibold text-text' : 'text-mute hover:bg-raise hover:text-text'">
          <span class="flex-1">{{ f.label }}</span>
          @if (count(f.id); as n) { <span class="rounded-full bg-raise px-2 text-[11.5px] tabular-nums text-mute">{{ n }}</span> }
        </button>
      }
    </nav>

    <section class="min-w-0" aria-label="Pull requests">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-edge bg-panel px-3">
          <app-icon name="search" [size]="15" class="text-faint" />
          <input class="w-full bg-transparent py-2 text-[13.5px] outline-none placeholder:text-faint" placeholder="Filtrar por título, repositório, autor ou projeto…"
                 [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Filtrar pull requests" />
        </div>
        <span class="text-[12px] text-faint">@if (svc.fetchedAt(); as t) { atualizado {{ t | ago }} }</span>
        <button type="button" class="btn btn-sm" [disabled]="!!svc.loading()" (click)="svc.load(filter(), true)">
          <app-icon name="sync" [size]="14" [class.animate-spin]="!!svc.loading()" />Atualizar</button>
      </div>

      @if (svc.error()) { <p role="alert" class="mt-4 rounded-xl border border-no/40 bg-no/5 px-4 py-3 text-[13px] text-no">{{ svc.error() }}</p> }

      <ul class="mt-4 overflow-hidden rounded-2xl border border-edge bg-panel" aria-live="polite">
        @for (p of visible(); track p.url) {
          <li class="group flex gap-3 border-b border-edge/70 px-4 py-3 last:border-b-0 hover:bg-raise/40">
            <app-icon [name]="p.draft ? 'prDraft' : 'pullRequest'" [size]="17" class="mt-0.5 shrink-0" [class]="p.draft ? 'text-faint' : 'text-yes'" />
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button type="button" class="text-left font-semibold leading-snug hover:text-frost hover:underline" (click)="open(p)">{{ p.title }}</button>
                @for (l of p.labels; track l.name) {
                  <span class="rounded-full border px-2 text-[11px]" [style.border-color]="l.color ? '#' + l.color : null" [style.color]="l.color ? '#' + l.color : null">{{ l.name }}</span>
                }
                @if (p.draft) { <span class="rounded-full border border-edge px-2 text-[11px] text-faint">rascunho</span> }
              </p>
              <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-mute">
                <span class="font-semibold text-text/80">{{ p.repoName }}#{{ p.number }}</span>
                <span>· {{ p.bot ? 'bot ' : '' }}{{ p.author }} · atualizado {{ p.updatedAt | ago }}</span>
                @if (p.base && p.head) { <span class="font-mono text-[11px] text-faint">{{ p.base }} ← {{ p.head }}</span> }
                @if (p.project) {
                  <button type="button" class="rounded-full px-2 text-[11px] font-semibold hover:underline" [style.color]="color(p.project.slug)" [style.background]="color(p.project.slug) + '22'"
                          (click)="goProject(p.project.slug)">{{ p.project.name }}</button>
                }
                @if (p.task) { <button type="button" class="text-[11.5px] text-frost hover:underline" (click)="dialogs.editTask(p.task.id)" [title]="p.task.title">tarefa #{{ p.task.id }}</button> }
              </p>
            </div>
            <!-- estado: CI, revisão, conflito, tamanho, comentários -->
            <div class="flex shrink-0 items-center gap-3 text-[12px]">
              @if (p.conflict) { <span class="rounded-full border border-no/40 px-2 py-0.5 text-[11px] font-semibold text-no">conflito</span> }
              @if (review(p); as r) { <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold {{ r.tone }}">{{ r.label }}</span> }
              @if (p.additions !== null) { <span class="font-mono tabular-nums"><span class="text-yes">+{{ p.additions }}</span> <span class="text-no">−{{ p.deletions }}</span></span> }
              @switch (p.checks) {
                @case ('success') { <span title="CI passou"><app-icon name="ok" [size]="16" class="text-yes" /></span> }
                @case ('failure') { <span title="CI falhou"><app-icon name="fail" [size]="16" class="text-no" /></span> }
                @case ('pending') { <span title="CI rodando"><app-icon name="dot" [size]="16" class="pulse text-later" /></span> }
              }
              <span class="flex w-9 items-center justify-end gap-1 text-faint" [title]="p.comments + ' comentários'">@if (p.comments) { <app-icon name="comments" [size]="14" />{{ p.comments }} }</span>
            </div>
          </li>
        } @empty {
          <li class="px-6 py-14 text-center text-[13.5px] text-mute">
            @if (svc.loading()) { <span class="flex items-center justify-center gap-2"><span class="pulse size-2 rounded-full bg-frost"></span>Buscando no GitHub…</span> }
            @else if (query()) { Nenhum PR combina com "{{ query() }}". }
            @else { Nenhum pull request aberto aqui. }
          </li>
        }
      </ul>
      @if (visible().length) { <p class="mt-2 text-[12px] text-faint">{{ visible().length }} {{ visible().length === 1 ? 'pull request aberto' : 'pull requests abertos' }} · clique no título para abrir no GitHub</p> }
    </section>`,
})
export class PullRequests {
  protected readonly svc = inject(PrsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);
  protected readonly filters = FILTERS;
  protected readonly filter = signal<PrFilter>('created');
  protected readonly query = signal('');

  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.svc.byFilter()[this.filter()] ?? [];
    return q ? list.filter(p => [p.title, p.repo, p.author, p.project?.name ?? '', `#${p.number}`].some(x => x.toLowerCase().includes(q))) : list;
  });

  constructor() {
    // trocou de filtro: busca (o backend guarda 90 s)
    effect(() => { const f = this.filter(); untracked(() => this.svc.load(f)); });
  }

  protected count(f: PrFilter): number | null { return this.svc.byFilter()[f]?.length ?? null; }
  protected review(p: PullRequest) { return p.review ? REVIEW[p.review] ?? null : null; }
  protected color(slug: string): string { return this.projects.bySlug().get(slug)?.color ?? '#7FA2FF'; }
  protected open(p: PullRequest): void { this.projects.openExternal(p.url); }
  protected goProject(slug: string): void { this.router.navigate(['/produtos', slug]); }
}
