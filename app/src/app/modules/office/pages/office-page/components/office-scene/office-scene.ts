import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

import { Icon } from '../../../../../../shared/ui/icon';
import { place } from '../../../../office-map';
import type { OfficeWorld, Person } from '../../../../office-world';

export type { Person };

/**
 * O andar em 3D. O three.js só carrega com esta tela (import dinâmico) e é descartado quando ela sai.
 * Arrastar gira, roda do mouse aproxima, botão direito arrasta; Q/E giram 90°.
 */
@Component({
  selector: 'app-office-scene',
  imports: [Icon],
  host: { class: 'relative block', '(keydown)': 'key($event)', tabindex: '0', 'aria-label': 'Escritório em 3D. Q e E giram a vista.' },
  template: `
    <div #stage class="absolute inset-0 overflow-hidden"></div>
    <div class="absolute right-3 bottom-3 flex gap-1 rounded-xl border border-edge bg-night/80 p-1 backdrop-blur">
      <button type="button" class="rounded-lg p-1.5 text-mute hover:bg-raise hover:text-text" (click)="world?.rotate(-1)" title="Girar para a esquerda (Q)" aria-label="Girar para a esquerda"><app-icon name="rotateLeft" [size]="16" /></button>
      <button type="button" class="rounded-lg p-1.5 text-mute hover:bg-raise hover:text-text" (click)="world?.reset()" title="Vista inicial" aria-label="Vista inicial"><app-icon name="center" [size]="16" /></button>
      <button type="button" class="rounded-lg p-1.5 text-mute hover:bg-raise hover:text-text" (click)="world?.rotate(1)" title="Girar para a direita (E)" aria-label="Girar para a direita"><app-icon name="rotateRight" [size]="16" /></button>
    </div>
    <p class="pointer-events-none absolute bottom-3 left-4 text-[11.5px] text-faint">Arraste para girar · roda aproxima · botão direito move</p>
    @if (failed()) {
      <p class="absolute inset-0 grid place-items-center text-[13px] text-mute">Não deu para abrir o 3D aqui (WebGL indisponível).</p>
    }
  `,
})
export class OfficeScene {
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  readonly people = input.required<Person[]>();
  readonly selected = input<string | null>(null);
  /** cores dos marcos em Agora (post-its no quadro da gestão) */
  readonly milestones = input<string[]>([]);
  readonly pick = output<string | null>();
  readonly open = output<string>();

  protected world: OfficeWorld | null = null;
  protected readonly failed = signal(false);
  // ponytail: o lugar de cada um fica guardado aqui (mutável) para ninguém trocar de mesa quando chega gente nova
  private readonly seats = new Map<string, string>();
  private readonly placed = computed(() => place(this.people().map(p => ({ key: p.key, room: p.room })), this.seats));

  constructor() {
    let gone = false;
    inject(DestroyRef).onDestroy(() => { gone = true; this.world?.destroy(); this.world = null; });
    afterNextRender(async () => {
      try {
        const { OfficeWorld } = await import('../../../../office-world');
        if (gone) return;
        this.world = new OfficeWorld(this.stage().nativeElement, { pick: k => this.pick.emit(k), open: k => this.open.emit(k) });
        (this.stage().nativeElement as HTMLElement & { office?: OfficeWorld }).office = this.world;
        this.sync();
      } catch {
        this.failed.set(true);
      }
    });
    effect(() => this.sync());
  }

  private sync(): void {
    const people = this.people(), placed = this.placed(), selected = this.selected(), milestones = this.milestones();
    this.world?.sync(people, placed, selected, milestones);
  }

  protected key(e: KeyboardEvent): void {
    if (e.key === 'q' || e.key === 'Q') this.world?.rotate(-1);
    if (e.key === 'e' || e.key === 'E') this.world?.rotate(1);
  }
}
