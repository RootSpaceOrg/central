import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList, CdkDropListGroup, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Component, computed, inject, input, signal } from '@angular/core';

import { Project } from '../../../../../../shared/services/projects/projects.model';
import { HORIZONS, Horizon, Milestone, RoadmapService } from '../../../../../../shared/services/roadmap/roadmap.service';
import { IdeasService } from '../../../../../../shared/services/ideas/ideas.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';

/**
 * Roadmap do projeto em Agora / Próximo / Depois: marcos (resultados, não tarefas) com o progresso das tarefas ligadas.
 * Arrastar muda a ordem e o horizonte; o gestor do projeto liga tarefas aos marcos e mantém isso vivo.
 */
@Component({
  selector: 'app-roadmap-panel',
  imports: [CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder, Icon, AgoPipe],
  host: { class: 'block' },
  template: `
    <section aria-labelledby="roadmap-title">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 id="roadmap-title" class="font-display text-lg font-semibold">Roadmap</h2>
        <span class="text-[12.5px] text-faint">Arraste entre as colunas. O progresso vem das tarefas ligadas ao marco.</span>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3" cdkDropListGroup>
        @for (h of horizons; track h.id) {
          <div class="flex min-h-40 flex-col rounded-2xl border border-edge bg-panel/60 p-3"
               [class]="h.id === 'now' ? 'border-frost/40 bg-frost/[0.04]' : ''">
            <p class="flex items-baseline gap-2 px-1">
              <span class="font-semibold" [class.text-frost]="h.id === 'now'">{{ h.label }}</span>
              <span class="text-[11.5px] text-faint">{{ h.hint }}</span>
            </p>
            <div cdkDropList [cdkDropListData]="cols()[h.id]" [id]="'rm-' + h.id" (cdkDropListDropped)="drop($event, h.id)"
                 class="mt-2 flex min-h-12 flex-1 flex-col gap-2">
              @for (m of cols()[h.id]; track m.id) {
                <article cdkDrag [cdkDragData]="m" class="group cursor-grab rounded-xl border border-edge bg-night px-3 py-2.5 active:cursor-grabbing">
                  <div class="flex items-start gap-2">
                    @if (editing() === m.id) {
                      <input class="field flex-1 !py-1 text-[13.5px]" [value]="m.title" aria-label="Nome do marco" (keydown.enter)="rename(m, $any($event.target).value)"
                             (keydown.escape)="editing.set(null)" (blur)="rename(m, $any($event.target).value)" autofocus />
                    } @else {
                      <p class="flex-1 text-[13.5px] font-semibold leading-snug" (dblclick)="editing.set(m.id)">{{ m.title }}</p>
                    }
                    <span class="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button type="button" class="rounded p-0.5 text-faint hover:text-yes" (click)="done(m)" title="Concluído" aria-label="Marcar como concluído"><app-icon name="check" [size]="13" /></button>
                      <button type="button" class="rounded p-0.5 text-faint hover:text-text" (click)="editing.set(m.id)" title="Renomear" aria-label="Renomear"><app-icon name="edit" [size]="13" /></button>
                      <button type="button" class="rounded p-0.5 text-faint hover:text-no" (click)="remove(m)" title="Excluir" aria-label="Excluir"><app-icon name="close" [size]="13" /></button>
                    </span>
                  </div>
                  @if (m.description) { <p class="mt-0.5 line-clamp-2 text-[12px] text-mute">{{ m.description }}</p> }
                  @if (m.author !== 'gustavo' || m.note) {
                    <p class="mt-1 flex items-start gap-1 text-[11.5px] text-faint" [title]="m.note ?? ''">
                      @if (m.author !== 'gustavo') { <app-icon name="spark" [size]="11" class="mt-[2px] shrink-0 text-frost" /> }
                      <span class="line-clamp-2">{{ m.note ?? 'sugerido por um agente' }}</span>
                    </p>
                  }
                  @if (ideasOf(m.id); as list) {
                    @if (list.length) {
                      <details class="mt-1.5" (mousedown)="$event.stopPropagation()">
                        <summary class="cursor-pointer text-[11.5px] text-mute hover:text-text">{{ list.length }} {{ list.length === 1 ? 'ideia' : 'ideias' }}</summary>
                        <ul class="mt-1 space-y-0.5">
                          @for (i of list; track i.id) {
                            <li class="group/i flex items-center gap-1.5 text-[12px]">
                              <span class="size-1.5 shrink-0 rounded-full" [class]="i.status === 'new' ? 'bg-later' : i.status === 'done' ? 'bg-yes' : i.status === 'doing' ? 'bg-frost' : 'bg-mute'"
                                    [title]="i.status === 'new' ? 'para triar' : i.status"></span>
                              <span class="min-w-0 flex-1 truncate" [title]="i.title">{{ i.title }}</span>
                              @if (i.tasks) { <span class="tabular-nums text-faint">{{ i.tasksDone }}/{{ i.tasks }}</span> }
                              <button type="button" class="opacity-0 group-hover/i:opacity-100 text-faint hover:text-no" (click)="ideas.setMilestone(i.id, null)" title="Desligar do marco" aria-label="Desligar ideia do marco"><app-icon name="close" [size]="11" /></button>
                            </li>
                          }
                        </ul>
                      </details>
                    }
                  }
                  <div class="mt-2 flex items-center gap-2 text-[11.5px] text-faint">
                    @if (m.tasks) {
                      <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-raise"><span class="block h-full rounded-full bg-yes transition-all" [style.width.%]="m.tasksDone / m.tasks * 100"></span></span>
                      <span class="tabular-nums">{{ m.tasksDone }}/{{ m.tasks }}</span>
                    } @else {
                      <span class="flex-1">sem tarefas ligadas</span>
                    }
                    @if (m.target) { <span class="rounded-full border border-edge px-1.5">{{ m.target }}</span> }
                  </div>
                  <div *cdkDragPlaceholder class="h-16 rounded-xl border border-dashed border-frost/50 bg-frost/5"></div>
                </article>
              }
            </div>
            <input class="mt-2 w-full rounded-lg bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-faint hover:bg-night/60 focus:bg-night"
                   [placeholder]="'+ marco em ' + h.label" [attr.aria-label]="'Novo marco em ' + h.label"
                   (keydown.enter)="add(h.id, $any($event.target))" />
          </div>
        }
      </div>
      @if (doneList().length) {
        <details class="mt-3">
          <summary class="cursor-pointer text-[12.5px] text-faint hover:text-mute">Feitos ({{ doneList().length }})</summary>
          <ul class="mt-2 space-y-1">
            @for (m of doneList(); track m.id) {
              <li class="flex items-center gap-2 text-[13px] text-mute">
                <app-icon name="check" [size]="13" class="text-yes" /><span class="flex-1 line-through decoration-faint">{{ m.title }}</span>
                <span class="text-[11.5px] text-faint">{{ m.doneAt | ago }}</span>
                <button type="button" class="text-[12px] text-frost hover:underline" (click)="roadmap.update(m.id, { horizon: 'now' })">reabrir</button>
              </li>
            }
          </ul>
        </details>
      }
      @if (error()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ error() }}</p> }
    </section>`,
})
export class RoadmapPanel {
  protected readonly roadmap = inject(RoadmapService);
  protected readonly ideas = inject(IdeasService);

  readonly project = input.required<Project>();

  protected readonly horizons = HORIZONS;
  protected readonly editing = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  /** listas mutáveis por coluna (o CDK mexe nelas ao arrastar) */
  protected readonly cols = computed<Record<Horizon, Milestone[]>>(() => {
    const slug = this.project().slug;
    return { now: this.roadmap.of(slug, 'now'), next: this.roadmap.of(slug, 'next'), later: this.roadmap.of(slug, 'later'), done: [] };
  });
  protected readonly doneList = computed(() => this.roadmap.of(this.project().slug, 'done').sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0)));

  /** ideias que servem ao marco (exceto descartadas) */
  protected ideasOf(id: number) { return this.ideas.ideas().filter(i => i.milestoneId === id && i.status !== 'archived'); }

  protected drop(e: CdkDragDrop<Milestone[]>, horizon: Horizon): void {
    const target = [...e.container.data];
    if (e.previousContainer === e.container) moveItemInArray(target, e.previousIndex, e.currentIndex);
    else transferArrayItem([...e.previousContainer.data], target, e.previousIndex, e.currentIndex);
    this.roadmap.reorder(target.map(m => m.id), horizon);
  }

  protected async add(horizon: Horizon, el: HTMLInputElement): Promise<void> {
    const title = el.value.trim();
    if (!title) return;
    try {
      await this.roadmap.create(this.project().slug, { title, horizon });
      el.value = '';
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  protected rename(m: Milestone, title: string): void {
    this.editing.set(null);
    if (title.trim() && title.trim() !== m.title) this.roadmap.update(m.id, { title: title.trim() });
  }

  protected done(m: Milestone): void { this.roadmap.update(m.id, { horizon: 'done' }); }

  protected remove(m: Milestone): void {
    if (confirm(`Excluir o marco "${m.title}"? As tarefas e ideias ligadas continuam, só perdem o vínculo.`)) this.roadmap.remove(m.id);
  }
}
