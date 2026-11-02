import { Component, ElementRef, inject, input, viewChild } from '@angular/core';

import { GridNode, GridSplit, isSplit, resize } from '../../../../services/grids/grid-tree';
import { GridsService } from '../../../../services/grids/grids.service';
import { GridTile } from '../grid-tile/grid-tile';

/** Um nó da árvore: divisão (filhos com divisórias arrastáveis) ou painel. Se usa recursivamente. */
@Component({
  selector: 'app-grid-node',
  imports: [GridTile],
  host: { class: 'block min-h-0 min-w-0' },
  template: `
    @if (asSplit(node()); as n) {
      <div #box class="flex h-full w-full min-h-0 min-w-0" [class.flex-col]="n.dir === 'col'">
        @for (c of n.children; track c.id; let i = $index, last = $last) {
          <app-grid-node class="relative" [style.flex]="n.sizes[i] + ' 1 0px'" [node]="c" />
          @if (!last) {
            <div role="separator" [attr.aria-orientation]="n.dir === 'row' ? 'vertical' : 'horizontal'" aria-label="Redimensionar painéis"
                 class="group relative shrink-0" [class]="n.dir === 'row' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'"
                 (pointerdown)="drag($event, n, i)" (dblclick)="even(n)" title="Arraste para redimensionar; duplo clique iguala">
              <span class="absolute rounded-full bg-frost opacity-0 transition-opacity group-hover:opacity-70"
                    [class]="n.dir === 'row' ? 'inset-y-2 left-0.5 w-0.5' : 'inset-x-2 top-0.5 h-0.5'"></span>
            </div>
          }
        }
      </div>
    } @else {
      <app-grid-tile class="h-full" [leaf]="$any(node())" />
    }`,
})
export class GridNodeView {
  private readonly grids = inject(GridsService);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  readonly node = input.required<GridNode>();

  protected asSplit(n: GridNode): GridSplit | null { return isSplit(n) ? n : null; }

  /** Arrasta a divisória entre o filho i e o i+1: só esses dois mudam de tamanho. */
  protected drag(e: PointerEvent, n: GridSplit, i: number): void {
    const box = this.box()?.nativeElement;
    if (!box) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const row = n.dir === 'row';
    const px = row ? box.clientWidth : box.clientHeight;
    const total = n.sizes.reduce((a, b) => a + b, 0);
    const start = row ? e.clientX : e.clientY;
    const [a, b] = [n.sizes[i], n.sizes[i + 1]];
    const min = total * 0.06;
    const move = (ev: PointerEvent) => {
      const d = Math.max(min - a, Math.min(b - min, ((row ? ev.clientX : ev.clientY) - start) / px * total));
      const sizes = [...n.sizes];
      sizes[i] = a + d;
      sizes[i + 1] = b - d;
      this.grids.update(r => resize(r, n.id, sizes));
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  protected even(n: GridSplit): void { this.grids.update(r => resize(r, n.id, n.sizes.map(() => 1))); }
}
