import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { ContextMenuService, MenuItem } from '../services/context-menu/context-menu.service';
import { Icon } from './icon';

/** Desenha o menu do ContextMenuService na posição do clique, sem sair da tela. */
@Component({
  selector: 'app-context-menu',
  imports: [Icon],
  host: {
    '(document:mousedown)': 'outside($event)', '(document:keydown)': 'key($event)',
    '(window:blur)': 'menu.close()', '(window:resize)': 'menu.close()', '(document:wheel)': 'menu.close()',
  },
  template: `
    @if (menu.state(); as s) {
      <div #box role="menu" tabindex="-1" class="fixed outline-none z-[70] min-w-52 rounded-xl border border-edge bg-raise p-1 shadow-[0_18px_50px_-12px_rgb(0_0_0/0.85)]"
           [style.left.px]="pos().x" [style.top.px]="pos().y">
        @for (e of s.items; track $index) {
          @if (e) {
            <button type="button" role="menuitem" [disabled]="e.disabled" (click)="choose(e)" (mouseenter)="active.set(indexOf(e))"
                    class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] disabled:opacity-40"
                    [class]="e.danger ? 'text-no' : 'text-text'" [class.bg-edge]="active() === indexOf(e)">
              <span class="grid w-4 place-items-center">@if (e.swatch) { <span class="size-3 rounded-full" [style.background]="e.swatch"></span> } @else if (e.img) { <img [src]="e.img" alt="" class="size-4" /> } @else if (e.icon) { <app-icon [name]="e.icon" [size]="15" [class.text-mute]="!e.danger" /> }</span>
              <span class="flex-1">{{ e.label }}</span>
              @if (e.hint) { <span class="text-[11.5px] text-faint">{{ e.hint }}</span> }
            </button>
          } @else {
            <div class="my-1 border-t border-edge" role="separator"></div>
          }
        }
      </div>
    }`,
})
export class ContextMenu {
  protected readonly menu = inject(ContextMenuService);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  protected readonly active = signal(-1);
  private readonly items = computed(() => (this.menu.state()?.items ?? []).filter((e): e is MenuItem => !!e && !e.disabled));
  /** fica dentro da janela: abre para cima/esquerda perto das bordas */
  protected readonly pos = signal({ x: 0, y: 0 });

  constructor() {
    effect(() => {
      const s = this.menu.state();
      this.active.set(-1);
      if (!s) return;
      this.pos.set({ x: s.x, y: s.y });
      queueMicrotask(() => {
        const el = this.box()?.nativeElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        this.pos.set({ x: Math.min(s.x, window.innerWidth - r.width - 8), y: Math.min(s.y, window.innerHeight - r.height - 8) });
        el.focus();
      });
    });
  }

  protected indexOf(e: MenuItem): number { return this.items().indexOf(e); }

  protected choose(e: MenuItem): void {
    this.menu.close();
    e.run();
  }

  protected outside(e: MouseEvent): void {
    if (this.menu.state() && !this.box()?.nativeElement.contains(e.target as Node)) this.menu.close();
  }

  protected key(e: KeyboardEvent): void {
    if (!this.menu.state()) return;
    const n = this.items().length;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.menu.close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set((this.active() + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set((this.active() - 1 + n) % n); }
    else if (e.key === 'Enter' && this.active() >= 0) { e.preventDefault(); this.choose(this.items()[this.active()]); }
  }
}
