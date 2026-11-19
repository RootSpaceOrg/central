import { Component, Injectable, computed, inject, signal } from '@angular/core';

import { ProjectsService } from '../shared/services/projects/projects.service';
import { Icon } from '../shared/ui/icon';
import { ProjectAvatar } from '../shared/ui/project-avatar';

const KEY = 'central.mobile.scope';

/**
 * O projeto escolhido no celular (como a barra lateral do PC): filtra Início, Para você e Conversas. O grupo inclui as
 * frentes. Guardado no aparelho.
 */
@Injectable({ providedIn: 'root' })
export class MobileScope {
  private readonly projects = inject(ProjectsService);
  readonly slug = signal<string | null>(localStorage.getItem(KEY) || null);
  readonly project = computed(() => (this.slug() ? this.projects.bySlug().get(this.slug()!) ?? null : null));
  /** o escolhido e as frentes dele */
  private readonly slugs = computed(() => {
    const s = this.slug();
    return s ? new Set([s, ...this.projects.children(s).map(c => c.slug)]) : null;
  });

  set(slug: string | null): void {
    this.slug.set(slug);
    if (slug) localStorage.setItem(KEY, slug); else localStorage.removeItem(KEY);
  }
  /** passa no filtro? (sem projeto escolhido, tudo passa) */
  matches(slug: string | null | undefined): boolean { const s = this.slugs(); return !s || (!!slug && s.has(slug)); }
}

/** o seletor no topo das abas: "Todos os projetos ▾" abre a lista (grupos com as frentes embaixo) */
@Component({
  selector: 'app-scope-picker',
  imports: [Icon, ProjectAvatar],
  template: `
    <button type="button" class="flex max-w-full items-center gap-2 rounded-full border border-edge bg-panel py-1.5 pr-3 pl-1.5 text-[13.5px] font-semibold active:bg-raise" (click)="open.set(true)"
            aria-haspopup="dialog">
      @if (scope.project(); as p) { <app-project-avatar [project]="p" [size]="22" /><span class="truncate">{{ p.name }}</span> }
      @else { <span class="grid size-[22px] place-items-center rounded-full bg-edge text-faint"><app-icon name="layers" [size]="12" /></span><span>Todos os projetos</span> }
      <app-icon name="chevron" [size]="12" class="rotate-90 text-faint" />
    </button>
    @if (open()) {
      <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" (click)="open.set(false)" role="dialog" aria-label="Escolher o projeto">
        <div class="max-h-[75dvh] overflow-y-auto rounded-t-3xl border-t border-edge bg-panel px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" (click)="$event.stopPropagation()">
          <div class="mx-auto mb-3 h-1 w-10 rounded-full bg-edge"></div>
          <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-raise" [class.bg-frost/15]="!scope.slug()" (click)="pick(null)">
            <span class="grid size-8 place-items-center rounded-lg bg-edge text-faint"><app-icon name="layers" [size]="15" /></span><span class="font-semibold">Todos os projetos</span></button>
          @for (p of roots(); track p.slug) {
            <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-raise" [class.bg-frost/15]="scope.slug() === p.slug" (click)="pick(p.slug)">
              <app-project-avatar [project]="p" [size]="32" /><span class="flex-1 truncate font-semibold">{{ p.name }}</span></button>
            @for (c of projects.children(p.slug); track c.slug) {
              <button type="button" class="ml-6 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-xl border-l border-edge px-3 py-2 text-left active:bg-raise" [class.bg-frost/15]="scope.slug() === c.slug" (click)="pick(c.slug)">
                <app-project-avatar [project]="c" [size]="24" /><span class="flex-1 truncate text-[14px]">{{ c.name }}</span></button>
            }
          }
        </div>
      </div>
    }`,
})
export class ScopePicker {
  protected readonly scope = inject(MobileScope);
  protected readonly projects = inject(ProjectsService);
  protected readonly open = signal(false);
  protected readonly roots = computed(() => this.projects.living().filter(p => !p.parentSlug).sort((a, b) => a.position - b.position));
  protected pick(slug: string | null): void { this.scope.set(slug); this.open.set(false); }
}
