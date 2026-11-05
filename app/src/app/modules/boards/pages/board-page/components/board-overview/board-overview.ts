import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { AgentSelect } from '../../../../../../shared/components/pickers/agent-select';
import { ProjectSelect } from '../../../../../../shared/components/pickers/project-select';
import { Board, BoardColumn, BoardService, COLORS, KIND_LABEL, blankColumn } from '../../../../../../shared/services/board/board.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { Select, SelectOption } from '../../../../../../shared/ui/select';

/**
 * Visão geral do quadro: nome, projeto, descrição e todas as colunas numa tabela (uma linha cada: nome, agente, depois,
 * reflexo no principal). Detalhes (descrição, instrução, limites) abrem na linha. Salva tudo de uma vez.
 */
@Component({
  selector: 'app-board-overview',
  imports: [Icon, ProjectSelect, AgentSelect, Select, CdkDropList, CdkDrag, CdkDragHandle],
  template: `
    <dialog #dlg (close)="closed.emit()" aria-labelledby="bo-title" class="m-auto w-[min(860px,94vw)] rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <form class="flex h-[min(720px,92vh)] flex-col" (submit)="save($event)">
        <header class="flex items-start gap-4 px-7 pt-6 pb-4">
          <h2 id="bo-title" class="flex-1 font-display text-xl font-semibold">Visão geral do quadro</h2>
          <button type="button" class="btn btn-ghost !p-2" (click)="close()" aria-label="Fechar"><app-icon name="close" /></button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-7 pb-5">
          <div class="grid grid-cols-[1.2fr_1fr] gap-3">
            <label class="block"><span class="mb-1 block text-[13px] font-semibold">Nome</span>
              <input class="field" [value]="name()" (input)="name.set($any($event.target).value)" required></label>
            <div><span class="mb-1 block text-[13px] font-semibold">Projeto</span>
              <app-project-select [value]="project()" (valueChange)="project.set($event)" noneLabel="Nenhum (quadro solto)" /></div>
            <label class="col-span-2 block"><span class="mb-1 block text-[13px] font-semibold">Descrição</span>
              <input class="field" [value]="description()" (input)="description.set($any($event.target).value)" placeholder="Para que serve este fluxo (os agentes leem)"></label>
          </div>

          <!-- tabela das colunas -->
          <div class="mt-5 overflow-hidden rounded-2xl border border-edge">
            <div class="grid grid-cols-[28px_1.3fr_1.2fr_1.1fr_1fr_56px] items-center gap-2 border-b border-edge bg-night px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
              <span></span><span>Coluna</span><span>Agente</span><span>Depois vai para</span><span>No principal</span><span></span>
            </div>
            <div cdkDropList (cdkDropListDropped)="reorder($event)">
              @for (c of cols(); track $index; let i = $index) {
                <div cdkDrag class="border-b border-edge bg-panel last:border-0">
                  <div class="grid grid-cols-[28px_1.3fr_1.2fr_1.1fr_1fr_56px] items-center gap-2 px-3 py-2">
                    <span cdkDragHandle class="cursor-grab text-faint" title="Arraste para reordenar"><app-icon name="grip" [size]="14" /></span>
                    <input class="field !py-1 text-[13px] font-semibold" [value]="c.label" (input)="set(i, { label: $any($event.target).value })" aria-label="Nome da coluna">
                    <app-agent-select class="min-w-0" [compact]="true" [hideCentral]="true" [value]="c.agentId ? '' + c.agentId : ''" noneLabel="—"
                                      (valueChange)="set(i, { agentId: $event ? +$event : null })" />
                    <app-select class="min-w-0" [compact]="true" [options]="nextOptions()[i]" [value]="c.nextKey ?? ''" [disabled]="!c.agentId"
                                (valueChange)="set(i, { nextKey: $event || null })" label="Depois vai para" />
                    <app-select class="min-w-0" [compact]="true" [options]="kinds" [value]="c.kind ?? ''" (valueChange)="set(i, { kind: $any($event) || null })" label="No backlog principal" />
                    <span class="flex justify-end gap-0.5">
                      <button type="button" class="rounded p-1 text-faint hover:text-text" (click)="toggle(i)" [attr.aria-expanded]="open().has(i)" title="Detalhes" aria-label="Detalhes">
                        <app-icon name="chevron" [size]="14" [class.rotate-90]="open().has(i)" /></button>
                      <button type="button" class="rounded p-1 text-faint hover:text-no" (click)="remove(i)" title="Remover" aria-label="Remover coluna"><app-icon name="delete" [size]="13" /></button>
                    </span>
                  </div>
                  @if (open().has(i)) {
                    <div class="grid grid-cols-[1fr_auto_auto] gap-3 px-3 pb-3 pl-[42px] text-[12.5px]">
                      <input class="field col-span-3 !py-1 text-[12.5px]" placeholder="Para que serve a coluna (os agentes leem)" [value]="c.description ?? ''" (input)="set(i, { description: $any($event.target).value || null })" aria-label="Descrição">
                      <div class="col-span-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Cor da coluna">
                        <span class="mr-1 text-mute">Cor</span>
                        <button type="button" role="radio" [attr.aria-checked]="!c.color" class="h-5 rounded-full border border-edge px-1.5 text-[11px]" [class.text-mute]="!!c.color" (click)="set(i, { color: null })">padrão</button>
                        @for (k of colors; track k.value) {
                          <button type="button" role="radio" [attr.aria-checked]="c.color === k.value" [attr.aria-label]="k.label" [title]="k.label" class="size-5 rounded-full ring-offset-1 ring-offset-panel"
                                  [style.background]="k.value" [class.ring-2]="c.color === k.value" [class.ring-text]="c.color === k.value" (click)="set(i, { color: k.value })"></button>
                        }
                      </div>
                      @if (c.agentId) {
                        <textarea class="field h-16 resize-y !py-1 text-[12.5px]" placeholder="O que o agente faz nesta etapa" [value]="c.instruction ?? ''" (input)="set(i, { instruction: $any($event.target).value || null })" aria-label="Instrução"></textarea>
                        <span class="flex items-center gap-1.5 self-start text-mute">até
                          <app-select class="w-16" [compact]="true" [options]="parallels" [value]="'' + c.parallel" (valueChange)="set(i, { parallel: +$event })"
                                      label="Quantas por vez" [minWidth]="80" /> por vez</span>
                        <input class="field !w-28 self-start !py-1 text-center text-[12.5px]" placeholder="qualquer hora" [value]="c.hours" (input)="set(i, { hours: $any($event.target).value.trim() })" aria-label="Horário (08-22)">
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
          <button type="button" class="mt-2 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] text-mute hover:bg-raise hover:text-text" (click)="add()"><app-icon name="plus" [size]="14" />Coluna</button>
        </div>

        <footer class="flex items-center gap-3 border-t border-edge px-7 py-4">
          @if (!confirmDelete()) {
            <button type="button" class="btn btn-ghost !px-2.5 !text-no" (click)="confirmDelete.set(true)" title="Excluir quadro" aria-label="Excluir quadro"><app-icon name="delete" [size]="16" /></button>
          } @else {
            <span class="text-[13px] text-no">Excluir o quadro? As tarefas continuam.</span>
            <button type="button" class="btn btn-ghost" (click)="confirmDelete.set(false)">Não</button>
            <button type="button" class="btn !border-no !bg-no !text-night" (click)="removeBoard()">Excluir</button>
          }
          @if (error()) { <p role="alert" class="text-[13px] text-no">{{ error() }}</p> }
          <span class="flex-1"></span>
          <button type="button" class="btn btn-ghost" (click)="close()">Cancelar</button>
          <button class="btn btn-primary" [disabled]="busy() || !name().trim()">Salvar</button>
        </footer>
      </form>
    </dialog>
  `,
})
export class BoardOverview {
  private readonly boards = inject(BoardService);
  private readonly router = inject(Router);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly board = input.required<Board>();
  readonly closed = output<void>();

  protected readonly kinds: SelectOption[] = [{ value: '', label: 'não muda' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))];
  protected readonly parallels: SelectOption[] = [1, 2, 3, 4].map(n => ({ value: String(n), label: String(n) }));
  protected readonly colors = COLORS;
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly project = signal('');
  protected readonly cols = signal<BoardColumn[]>([]);
  protected readonly open = signal<ReadonlySet<number>>(new Set());
  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly error = signal<string | null>(null);
  /** "depois vai para" de cada linha: a próxima ou outra coluna (com chave) */
  protected readonly nextOptions = computed(() => this.cols().map((_, i) =>
    [{ value: '', label: 'a próxima' }, ...this.cols().filter((o, j) => j !== i && o.key).map(o => ({ value: o.key, label: o.label }))]));

  constructor() {
    afterNextRender(() => {
      const b = this.board();
      this.name.set(b.name); this.description.set(b.description ?? ''); this.project.set(b.projectSlug ?? '');
      this.cols.set(b.columns.map(c => ({ ...c })));
      this.dlg().nativeElement.showModal();
    });
  }

  protected set(i: number, patch: Partial<BoardColumn>): void { this.cols.update(l => l.map((c, j) => (j === i ? { ...c, ...patch } : c))); }
  protected toggle(i: number): void { const s = new Set(this.open()); if (s.has(i)) s.delete(i); else s.add(i); this.open.set(s); }
  protected add(): void { this.cols.update(l => [...l, blankColumn('Nova coluna')]); this.toggle(this.cols().length - 1); }
  protected remove(i: number): void {
    const gone = this.cols()[i].key;
    this.cols.update(l => l.filter((_, j) => j !== i).map(c => (c.nextKey === gone ? { ...c, nextKey: null } : c)));
    this.open.set(new Set());
  }
  protected reorder(e: CdkDragDrop<unknown>): void {
    const l = [...this.cols()];
    moveItemInArray(l, e.previousIndex, e.currentIndex);
    this.cols.set(l);
    this.open.set(new Set());
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    if (this.cols().some(c => !c.label.trim())) { this.error.set('Dê nome a todas as colunas.'); return; }
    if (!this.cols().length) { this.error.set('O quadro precisa de pelo menos uma coluna.'); return; }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.boards.update(this.board().id, { name: this.name().trim(), description: this.description().trim() || null, project_slug: this.project() || null });
      await this.boards.saveColumns(this.board().id, this.cols().map(c => ({ ...c, label: c.label.trim() })));
      this.close();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeBoard(): Promise<void> {
    await this.boards.remove(this.board().id);
    this.close();
    this.router.navigate(['/quadros']);
  }

  protected close(): void { this.dlg().nativeElement.close(); }
}
