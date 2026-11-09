import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { SessionView } from '../../../../../../shared/components/session-view/session-view';
import { SessionKind, TerminalKind } from '../../../../../../shared/contract';
import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { ContextMenuService } from '../../../../../../shared/services/context-menu/context-menu.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { SESSION_IMG, SESSION_KINDS, Session, SessionsService } from '../../../../../../shared/services/sessions/sessions.service';
import { TerminalsService } from '../../../../../../shared/services/terminals/terminals.service';
import { LiveService } from '../../../../../../shared/services/live/live.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';
import { DropEdge, GridLeaf, assign, leaf, move, rects, remove, split } from '../../../../services/grids/grid-tree';
import { GridsService } from '../../../../services/grids/grids.service';

/** Onde aparece o destaque ao arrastar um painel por cima: metade da borda, ou o centro (troca). */
const ZONE: Record<DropEdge, string> = {
  left: 'inset-y-0 left-0 w-1/2', right: 'inset-y-0 right-0 w-1/2', top: 'inset-x-0 top-0 h-1/2', bottom: 'inset-x-0 bottom-0 h-1/2', center: 'inset-6',
};

/** Painel da Grade: cabeçalho arrastável + a sessão (de qualquer projeto), ou o seletor quando está vazio. */
@Component({
  selector: 'app-grid-tile',
  imports: [Icon, ProjectAvatar, SessionView],
  host: {
    class: 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border shadow-[0_10px_30px_-18px_rgb(0_0_0/0.9)]',
    '[class]': "session() ? 'border-edge bg-night' : 'border-dashed border-faint/40 bg-night/40 backdrop-blur-sm'",
    // a sessão é o nome da animação: ela desliza para o novo lugar mesmo quando o painel é recriado
    '[style.view-transition-name]': "'tile-' + (leaf().sessionId ?? leaf().id)",
  },
  template: `
    <header class="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-edge bg-panel pr-1 pl-2 active:cursor-grabbing"
            draggable="true" (dragstart)="dragStart($event)" (dragend)="grids.dragging.set(null); grids.hover.set(null)" (contextmenu)="more($event)">
      <app-icon name="grip" [size]="13" class="shrink-0 text-faint" />
      @if (session(); as s) {
        <img [src]="img[s.kind]" alt="" class="size-3.5 shrink-0" />
        @if (project(); as p) {
          <app-project-avatar [project]="p" [size]="16" class="shrink-0" [title]="p.name" />
          <span class="shrink-0 text-[12px] font-semibold" [style.color]="p.color">{{ p.name }}</span>
        }
        <span class="min-w-0 truncate text-[12.5px] text-mute" [title]="s.title">{{ s.title }}</span>
        @if (live.chat(s.chatId); as a) {
          <span class="flex shrink-0 items-center gap-1 rounded-full bg-frost/15 px-1.5 text-[11px] tabular-nums text-frost" [title]="a.step ?? 'Trabalhando'">
            <span class="pulse size-1.5 rounded-full bg-frost"></span>{{ live.since(a.startedAt) }}@if (live.running(a); as n) { <span class="text-[#C6A6FF]">· {{ n }} sub</span> }</span>
        } @else if (s.kind === 'claude' && terminals.busy().get(s.id); as t) {
          <span class="flex shrink-0 items-center gap-1 rounded-full bg-frost/15 px-1.5 text-[11px] tabular-nums text-frost"><span class="pulse size-1.5 rounded-full bg-frost"></span>{{ live.since(t) }}</span>
        }
      } @else {
        <span class="text-[12.5px] text-faint">Painel vazio</span>
      }
      <span class="flex-1"></span>
      <button type="button" class="tile-btn" (click)="plus($event)" title="Nova sessão ao lado" aria-label="Nova sessão ao lado"><app-icon name="plus" [size]="14" /></button>
      <button type="button" class="tile-btn" (click)="splitTile('row')" title="Dividir para a direita" aria-label="Dividir para a direita"><app-icon name="splitRight" [size]="14" /></button>
      <button type="button" class="tile-btn" (click)="splitTile('col')" title="Dividir para baixo" aria-label="Dividir para baixo"><app-icon name="splitDown" [size]="14" /></button>
      <button type="button" class="tile-btn" (click)="more($event)" title="Mais" aria-label="Mais opções do painel"><app-icon name="more" [size]="14" /></button>
      <button type="button" class="tile-btn hover:!text-no" (click)="closeTile()" title="Fechar painel (a sessão continua no projeto)" aria-label="Fechar painel"><app-icon name="close" [size]="14" /></button>
    </header>

    <div class="relative min-h-0 flex-1">
      @if (session(); as s) {
        <app-session-view class="absolute inset-0" [session]="s" [compact]="true" />
      } @else {
        <!-- seletor: projeto → tipo de sessão, ou uma sessão que já existe -->
        <div class="absolute inset-0 overflow-y-auto p-5">
          <div class="mb-4 flex items-center gap-3">
            <p class="flex-1 font-display text-[15px] font-semibold">O que abrir aqui?</p>
            <button type="button" class="btn btn-sm" (click)="grids.addOpen.set(true)"><app-icon name="grid" [size]="14" />Várias de uma vez</button>
          </div>
          <p class="text-[12.5px] font-semibold text-faint">Projeto</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            @for (p of projects.living(); track p.slug) {
              <button type="button" (click)="pick.set(p.slug)" [attr.aria-pressed]="slug() === p.slug" [title]="p.name" [class.opacity-50]="!p.folderExists"
                      class="flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-[12.5px] transition"
                      [class]="slug() === p.slug ? 'border-frost bg-frost/10 text-text' : 'border-edge text-mute hover:border-faint hover:text-text'">
                <app-project-avatar [project]="p" [size]="20" />{{ p.name }}</button>
            }
          </div>
          <p class="mt-5 text-[12.5px] font-semibold text-faint">Nova sessão</p>
          <div class="mt-2 flex flex-wrap gap-2">
            @for (k of kinds; track k.kind) {
              <button type="button" (click)="create(k.kind)" [disabled]="!slug()"
                      class="flex items-center gap-2 rounded-xl border border-edge bg-panel px-3 py-2 text-[13px] transition hover:border-faint hover:bg-raise disabled:opacity-40">
                <img [src]="k.img" alt="" class="size-4" />{{ k.label }}@if (k.hint) { <span class="text-[11.5px] text-faint">{{ k.hint }}</span> }</button>
            }
          </div>
          @if (existing().length) {
            <p class="mt-5 text-[12.5px] font-semibold text-faint">Sessões abertas no projeto</p>
            <div class="mt-2 space-y-1">
              @for (s of existing(); track s.id) {
                <button type="button" (click)="setSession(s.id)"
                        class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-mute hover:bg-raise hover:text-text">
                  <img [src]="img[s.kind]" alt="" class="size-4" /><span class="truncate">{{ s.title }}</span></button>
              }
            </div>
          }
        </div>
      }

      <!-- arrastando outro painel: escolha onde soltar -->
      @if (grids.dragging() && grids.dragging() !== leaf().id) {
        <div class="absolute inset-0 z-20" (dragover)="over($event)" (dragleave)="leave()" (drop)="drop($event)">
          @if (edge(); as e) { <div class="pointer-events-none absolute rounded-lg border-2 border-frost bg-frost/15 transition-all {{ zone[e] }}"></div> }
        </div>
      }
    </div>`,
  styles: [`.tile-btn { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; color: var(--color-faint); }
            .tile-btn:hover { background: var(--color-raise); color: var(--color-text); }`],
})
export class GridTile {
  protected readonly grids = inject(GridsService);
  protected readonly projects = inject(ProjectsService);
  protected readonly sessions = inject(SessionsService);
  protected readonly chat = inject(ChatService);
  protected readonly terminals = inject(TerminalsService);
  protected readonly live = inject(LiveService);
  private readonly menu = inject(ContextMenuService);
  private readonly router = inject(Router);

  readonly leaf = input.required<GridLeaf>();

  protected readonly kinds = SESSION_KINDS;
  protected readonly img = SESSION_IMG;
  protected readonly zone = ZONE;
  protected readonly edge = signal<DropEdge | null>(null);
  protected readonly pick = signal<string | null>(null);

  protected readonly session = computed(() => {
    const id = this.leaf().sessionId;
    return id === null ? null : this.sessions.byId().get(id) ?? null;
  });
  protected readonly project = computed(() => {
    const s = this.session();
    return s ? this.projects.bySlug().get(s.projectSlug) ?? null : null;
  });
  protected readonly slug = computed(() => this.pick() ?? this.projects.defaultSlug());
  /** sessões do projeto escolhido que ainda não estão na grade */
  protected readonly existing = computed(() => {
    const slug = this.slug();
    return slug ? this.sessions.of(slug).filter(s => !this.grids.placed().has(s.id)) : [];
  });

  protected setSession(id: number | null): void { this.grids.change(r => assign(r, this.leaf().id, id)); }
  protected closeTile(): void { this.grids.change(r => remove(r, this.leaf().id)); }

  protected splitTile(dir: 'row' | 'col'): void { this.grids.change(r => split(r, this.leaf().id, dir)); }

  /** "+" do cabeçalho: sessão nova do mesmo projeto ao lado deste painel (pelo lado mais comprido). */
  protected plus(e: MouseEvent): void {
    const slug = this.session()?.projectSlug ?? this.slug();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.open(new MouseEvent('click', { clientX: r.left - 180, clientY: r.bottom + 4 }), [
      ...(slug ? SESSION_KINDS.map(k => ({ label: k.label, img: k.img, hint: this.projects.bySlug().get(slug)?.name, run: () => this.besides(slug, k.kind) })) : []),
      null,
      { label: 'Várias sessões, outros projetos…', icon: 'grid', run: () => this.grids.addOpen.set(true) },
    ]);
  }

  private async besides(slug: string, kind: SessionKind): Promise<void> {
    const s = await this.sessions.open(slug, kind, null, false);
    if (!s) return;
    this.grids.change(root => {
      const box = rects(root).get(this.leaf().id);
      return split(root, this.leaf().id, !box || box.w * this.grids.aspect() >= box.h ? 'row' : 'col', leaf(s.id));
    });
  }

  protected async create(kind: SessionKind): Promise<void> {
    const slug = this.slug();
    if (!slug) return;
    const s = await this.sessions.open(slug, kind, null, false);
    if (s) this.setSession(s.id);
  }

  protected dragStart(e: DragEvent): void {
    e.dataTransfer?.setData('text/plain', this.leaf().id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    // espera o navegador tirar a "foto" do arrasto antes de cobrir os painéis com as zonas de soltar
    setTimeout(() => this.grids.dragging.set(this.leaf().id));
  }

  protected over(e: DragEvent): void {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const d = Math.min(x, 1 - x, y, 1 - y);
    const edge: DropEdge = d > 0.25 ? 'center' : d === x ? 'left' : d === 1 - x ? 'right' : d === y ? 'top' : 'bottom';
    if (edge === this.edge()) return;
    this.edge.set(edge);
    this.grids.hover.set({ to: this.leaf().id, edge });
  }

  protected leave(): void {
    this.edge.set(null);
    if (this.grids.hover()?.to === this.leaf().id) this.grids.hover.set(null);
  }

  protected drop(e: DragEvent): void {
    e.preventDefault();
    const from = this.grids.dragging();
    const edge = this.edge();
    this.edge.set(null);
    this.grids.dragging.set(null);
    this.grids.hover.set(null);
    if (from && edge) this.grids.change(r => move(r, from, this.leaf().id, edge));
  }

  protected more(e: MouseEvent): void {
    const s = this.session();
    const at = e.type === 'contextmenu' ? e : (() => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return new MouseEvent('click', { clientX: r.left - 160, clientY: r.bottom + 4 });
    })();
    this.menu.open(at, [
      { label: 'Dividir para a direita', icon: 'splitRight', run: () => this.splitTile('row') },
      { label: 'Dividir para baixo', icon: 'splitDown', run: () => this.splitTile('col') },
      ...(s ? [
        null,
        { label: 'Trocar sessão', icon: 'sync' as const, run: () => this.setSession(null) },
        { label: 'Abrir no projeto', icon: 'folder' as const, run: () => { this.sessions.select(s.projectSlug, s.id); this.router.navigate(['/projetos', s.projectSlug]); } },
        ...(s.kind !== 'chat' ? [{ label: 'Reiniciar terminal', icon: 'play' as const, run: () => this.restart(s) }] : []),
        { label: 'Fechar a sessão', icon: 'delete' as const, danger: true, run: () => this.sessions.close(s) },
      ] : []),
      null,
      { label: 'Fechar painel', icon: 'close', run: () => this.closeTile() },
    ]);
  }

  private restart(s: Session): void {
    const folder = this.projects.bySlug().get(s.projectSlug)?.folder;
    if (folder) this.terminals.start(s.id, folder, s.kind as TerminalKind, s.projectSlug);
  }
}
