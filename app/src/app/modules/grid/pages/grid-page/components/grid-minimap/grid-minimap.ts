import { Component, computed, inject } from '@angular/core';

import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { SESSION_IMG, SessionsService } from '../../../../../../shared/services/sessions/sessions.service';
import { leaves, rects } from '../../../../services/grids/grid-tree';
import { GridsService } from '../../../../services/grids/grids.service';

const W = 260;

/** Prévia de como a grade fica se soltar o painel agora (aparece enquanto arrasta). */
@Component({
  selector: 'app-grid-minimap',
  host: { class: 'pointer-events-none block rounded-2xl border border-edge bg-panel/90 p-3 shadow-2xl backdrop-blur', 'aria-hidden': 'true' },
  template: `
    <p class="mb-2 text-[11.5px] font-semibold text-mute">{{ grids.hover() ? (grids.hover()!.edge === 'center' ? 'Trocar de lugar' : 'Encaixar ' + side[grids.hover()!.edge]) : 'Arraste até um painel' }}</p>
    <div class="relative" [style.width.px]="w" [style.height.px]="h">
      @for (b of boxes(); track b.key) {
        <div class="absolute flex items-center justify-center gap-1 overflow-hidden rounded-md border text-[10px] transition-all duration-200"
             [class]="b.moving ? 'border-frost bg-frost/30 text-text' : 'border-edge bg-night/80 text-mute'"
             [style.left.px]="b.x + 2" [style.top.px]="b.y + 2" [style.width.px]="b.w - 4" [style.height.px]="b.h - 4"
             [style.box-shadow]="'inset 3px 0 0 ' + b.color">
          @if (b.img) { <img [src]="b.img" alt="" class="size-3" /> }
          @if (b.w > 70) { <span class="truncate px-0.5">{{ b.label }}</span> }
        </div>
      }
    </div>`,
})
export class GridMinimap {
  protected readonly grids = inject(GridsService);
  private readonly sessions = inject(SessionsService);
  private readonly projects = inject(ProjectsService);

  protected readonly side: Record<string, string> = { left: 'à esquerda', right: 'à direita', top: 'em cima', bottom: 'embaixo' };
  protected readonly w = W;
  protected get h(): number { return Math.round(W / this.grids.aspect()); }

  protected readonly boxes = computed(() => {
    const root = this.grids.preview();
    if (!root) return [];
    const r = rects(root);
    const dragged = leaves(this.grids.active()!.root).find(l => l.id === this.grids.dragging())?.sessionId ?? null;
    const h = Math.round(W / this.grids.aspect());
    return leaves(root).map(l => {
      const s = l.sessionId === null ? null : this.sessions.byId().get(l.sessionId);
      const p = s ? this.projects.bySlug().get(s.projectSlug) : null;
      const box = r.get(l.id)!;
      return {
        key: l.sessionId ?? l.id, x: box.x * W, y: box.y * h, w: box.w * W, h: box.h * h,
        img: s ? SESSION_IMG[s.kind] : null, label: s ? s.title : 'vazio',
        color: p?.color ?? 'transparent', moving: l.sessionId !== null && l.sessionId === dragged,
      };
    });
  });
}
