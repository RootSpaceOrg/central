import { Component, ElementRef, OnDestroy, effect, inject, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { ContextMenuService } from '../../../../shared/services/context-menu/context-menu.service';
import { LayoutService } from '../../../../shared/services/layout/layout.service';
import { SessionsService } from '../../../../shared/services/sessions/sessions.service';
import { Icon } from '../../../../shared/ui/icon';
import { TEMPLATES, assign, leaf, leaves, split } from '../../services/grids/grid-tree';
import { GridPreset, GridsService } from '../../services/grids/grids.service';
import { AddSessions } from './components/add-sessions/add-sessions';
import { GridMinimap } from './components/grid-minimap/grid-minimap';
import { GridNodeView } from './components/grid-node/grid-node';

import { AskService } from '../../../../shared/services/ask/ask.service';
/**
 * Grade: várias sessões (de projetos diferentes) lado a lado, em painéis que dividem, redimensionam e trocam de lugar.
 * Cada grade é um preset salvo (ex.: "KultivAi + suporte"). F11 = modo foco.
 */
@Component({
  selector: 'app-grid-page',
  imports: [Icon, GridNodeView, GridMinimap, AddSessions],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (!layout.focus()) {
      <div class="flex h-11 shrink-0 items-center gap-1 border-b border-edge bg-panel px-3" role="tablist" aria-label="Grades salvas">
        <app-icon name="grid" [size]="16" class="mr-1 text-frost" />
        @for (p of grids.presets(); track p.id) {
          <button type="button" role="tab" [attr.aria-selected]="p.id === grids.active()?.id" (click)="grids.select(p.id)"
                  (dblclick)="rename(p)" (contextmenu)="presetMenu($event, p)"
                  class="rounded-lg px-3 py-1 text-[13px] font-medium"
                  [class]="p.id === grids.active()?.id ? 'bg-raise text-text' : 'text-mute hover:bg-raise/60 hover:text-text'">{{ p.name }}</button>
        }
        <button type="button" class="grid size-7 place-items-center rounded-lg text-mute hover:bg-raise hover:text-text" (click)="newGrid($event)"
                title="Nova grade" aria-label="Nova grade"><app-icon name="plus" [size]="15" /></button>
        <span class="flex-1"></span>
        <span class="mr-3 hidden text-[12px] text-faint xl:inline">Arraste o cabeçalho de um painel para mover. Divisórias redimensionam.</span>
        <button type="button" class="btn btn-sm btn-primary" (click)="grids.addOpen.set(true)"><app-icon name="plus" [size]="14" />Adicionar sessões</button>
        <button type="button" class="btn btn-sm" (click)="layout.setFocus(true)" title="Modo foco (F11)"><app-icon name="focus" [size]="14" />Foco</button>
      </div>
    } @else {
      <button type="button" class="fixed right-3 bottom-3 z-40 flex items-center gap-1.5 rounded-lg border border-edge bg-panel/90 px-2.5 py-1 text-[12px] text-mute opacity-30 transition hover:opacity-100"
              (click)="layout.setFocus(false)" title="Sair do modo foco (F11)"><app-icon name="unfocus" [size]="13" />Sair do foco</button>
    }
    <div #area class="grid-bg relative min-h-0 flex-1" [class]="layout.focus() ? 'p-1.5' : 'p-3'">
      @if (grids.active(); as g) { <app-grid-node class="h-full" [node]="g.root" /> }
      @if (grids.dragging()) { <app-grid-minimap class="absolute bottom-5 left-1/2 z-30 -translate-x-1/2" /> }
    </div>
    <app-add-sessions [(open)]="grids.addOpen" />`,
})
export class GridPage implements OnDestroy {
  private readonly ask = inject(AskService);
  protected readonly grids = inject(GridsService);
  protected readonly layout = inject(LayoutService);
  private readonly sessions = inject(SessionsService);
  private readonly menu = inject(ContextMenuService);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  private readonly area = viewChild<ElementRef<HTMLElement>>('area');
  private readonly observer = new ResizeObserver(([e]) => {
    if (e.contentRect.height) this.grids.aspect.set(e.contentRect.width / e.contentRect.height);
  });

  constructor() {
    effect(() => { const el = this.area()?.nativeElement; if (el) this.observer.observe(el); });
    // sessões fechadas em outro lugar viram painel vazio
    effect(() => {
      this.sessions.byId();
      if (this.grids.loaded()) untracked(() => this.grids.prune());
    });
    // ?sessao=12 ("Levar para a Grade" na aba do projeto): ocupa um painel vazio ou abre um à direita
    effect(() => {
      const id = Number(this.query()?.get('sessao'));
      const g = this.grids.active();
      if (!id || !g || !this.grids.loaded()) return;
      untracked(() => {
        if (!this.grids.placed().has(id)) {
          const empty = leaves(g.root).find(l => l.sessionId === null);
          this.grids.update(r => (empty ? assign(r, empty.id, id) : split(r, leaves(r).at(-1)!.id, 'row', leaf(id))));
        }
        this.router.navigate([], { queryParams: { sessao: null }, replaceUrl: true });
      });
    });
  }

  protected newGrid(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.open(new MouseEvent('click', { clientX: r.left, clientY: r.bottom + 4 }), [
      ...TEMPLATES.map(t => ({ label: t.label, icon: 'grid' as const, run: async () => { const name = await this.ask.text('Nome da grade', t.label, { confirmLabel: 'Criar' }); if (name !== null) this.grids.create(name.trim() || t.label, t.id); } })),
      null,
      { label: 'Duplicar a atual', icon: 'plus', run: () => this.grids.duplicate() },
    ]);
  }

  protected async rename(p: GridPreset): Promise<void> {
    const name = (await this.ask.text('Nome da grade', p.name))?.trim();
    if (name) this.grids.rename(p.id, name);
  }

  protected presetMenu(e: MouseEvent, p: GridPreset): void {
    this.menu.open(e, [
      { label: 'Renomear', icon: 'edit', run: () => this.rename(p) },
      { label: 'Duplicar', icon: 'plus', run: () => { this.grids.select(p.id); this.grids.duplicate(); } },
      null,
      { label: 'Excluir grade', icon: 'delete', danger: true, run: async () => { if (await this.ask.confirm(`Excluir a grade "${p.name}"?`, { message: 'As sessões continuam nos projetos.', confirmLabel: 'Excluir grade', danger: true })) this.grids.remove(p.id); } },
    ]);
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
    if (this.layout.focus()) this.layout.setFocus(false);
  }
}
