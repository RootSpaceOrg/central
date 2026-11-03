import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

import { TaskColumn } from '../../../../../../shared/contract';
import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { BOARD_TEMPLATES, BoardColumn, BoardService, KIND_LABEL } from '../../../../../../shared/services/board/board.service';
import { Project } from '../../../../../../shared/services/projects/projects.model';
import { Icon } from '../../../../../../shared/ui/icon';

/** Linha do editor: a coluna + para qual linha vai depois (índice, vira key ao salvar). */
interface Row extends BoardColumn { next: number | null; open: boolean }

const KINDS = Object.entries(KIND_LABEL).map(([id, label]) => ({ id: id as TaskColumn, label }));
/** "Revisão técnica" → "revisao-tecnica" (o mesmo que o backend faz) */
const keyOf = (label: string) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'coluna';

/**
 * Workflow do quadro do projeto: colunas livres (nome, tipo, descrição) e, em cada uma, o agente que pega o que entra nela,
 * com instrução, limites e para onde a tarefa vai quando ele termina. Começa de um modelo; vazio = quadro padrão.
 */
@Component({
  selector: 'app-board-editor',
  imports: [Icon, CdkDropList, CdkDrag, CdkDragHandle],
  template: `
    <dialog #dlg (close)="closed.emit()" aria-labelledby="wf-title" class="m-auto w-[min(880px,94vw)] rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <form class="flex h-[min(760px,92vh)] flex-col" (submit)="save($event)">
        <header class="flex items-start gap-4 px-8 pt-7 pb-4">
          <div class="flex-1">
            <h2 id="wf-title" class="font-display text-2xl font-semibold">Workflow do quadro</h2>
            <p class="mt-0.5 text-[13px] text-mute">{{ project().name }}: as colunas e quem cuida de cada uma. Os agentes do projeto recebem este quadro e sabem o que cada coluna significa.</p>
          </div>
          <button type="button" class="btn btn-ghost !p-2" (click)="close()" aria-label="Fechar"><app-icon name="close" /></button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
          <!-- modelos -->
          <p class="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-faint">{{ rows().length ? 'Trocar por um modelo' : 'Comece de um modelo' }}</p>
          <div class="grid grid-cols-3 gap-2">
            @for (t of templates; track t.id) {
              <button type="button" class="rounded-2xl border border-edge bg-night px-4 py-3 text-left transition hover:border-faint" (click)="useTemplate(t.id)">
                <span class="block font-semibold">{{ t.label }}</span>
                <span class="mt-0.5 block text-[12.5px] text-mute">{{ t.hint }}</span>
              </button>
            }
          </div>

          @if (rows().length) {
            <p class="mt-6 mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-faint">Colunas, da esquerda para a direita</p>
            <div cdkDropList (cdkDropListDropped)="reorder($event)" class="space-y-2">
              @for (r of rows(); track $index; let i = $index) {
                <div cdkDrag class="rounded-2xl border border-edge bg-night">
                  <div class="flex items-center gap-2 px-3 py-2.5">
                    <span cdkDragHandle class="cursor-grab px-1 text-faint" title="Arraste para reordenar"><app-icon name="grip" [size]="15" /></span>
                    <input class="field !w-48 !py-1.5 font-semibold" [value]="r.label" (input)="set(i, { label: $any($event.target).value })" aria-label="Nome da coluna" placeholder="Nome">
                    <select class="field !w-32 !py-1.5 text-[13px]" (change)="set(i, { kind: $any($event.target).value })" aria-label="Tipo" title="O que a coluna significa para a Central">
                      @for (k of kinds; track k.id) { <option [value]="k.id" [selected]="r.kind === k.id">{{ k.label }}</option> }
                    </select>
                    <input class="field min-w-0 flex-1 !py-1.5 text-[13px]" [value]="r.description ?? ''" (input)="set(i, { description: $any($event.target).value })" placeholder="Para que serve (os agentes leem)" aria-label="Descrição">
                    <button type="button" class="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12.5px]" (click)="set(i, { open: !r.open })"
                            [class]="r.agentId ? 'bg-frost/10 text-frost' : 'text-mute hover:text-text'" [attr.aria-expanded]="r.open">
                      <app-icon name="agent" [size]="13" />{{ agentName(r.agentId) ?? 'Agente' }}</button>
                    <button type="button" class="shrink-0 rounded p-1 text-faint hover:text-no" (click)="remove(i)" title="Remover coluna" aria-label="Remover coluna"><app-icon name="delete" [size]="14" /></button>
                  </div>
                  @if (r.open) {
                    <div class="grid grid-cols-2 gap-3 border-t border-edge px-4 py-3 text-[13px]">
                      <label class="block"><span class="mb-1 block text-mute">Agente que pega o que entra aqui</span>
                        <select class="field" (change)="set(i, { agentId: $any($event.target).value ? +$any($event.target).value : null })">
                          <option value="" [selected]="!r.agentId">Ninguém (você move)</option>
                          @for (a of agentList(); track a.id) { <option [value]="a.id" [selected]="r.agentId === a.id">{{ a.name }}</option> }
                        </select></label>
                      <label class="block"><span class="mb-1 block text-mute">Quando ele terminar bem, vai para</span>
                        <select class="field" (change)="set(i, { next: $any($event.target).value === '' ? null : +$any($event.target).value })">
                          <option value="" [selected]="r.next === null">Revisão (padrão)</option>
                          @for (o of rows(); track $index; let j = $index) { @if (j !== i) { <option [value]="j" [selected]="r.next === j">{{ o.label || 'sem nome' }}</option> } }
                        </select></label>
                      <label class="col-span-2 block"><span class="mb-1 block text-mute">O que ele faz nesta etapa</span>
                        <textarea class="field h-20 resize-y" [value]="r.instruction ?? ''" (input)="set(i, { instruction: $any($event.target).value })"
                                  placeholder="Ex.: Revise o PR da tarefa: bugs, segurança, convenções. Comente no PR."></textarea></label>
                      <label class="block"><span class="mb-1 block text-mute">Até quantas por vez</span>
                        <select class="field" (change)="set(i, { parallel: +$any($event.target).value })">
                          @for (n of [1, 2, 3, 4]; track n) { <option [value]="n" [selected]="r.parallel === n">{{ n }}</option> }
                        </select></label>
                      <label class="block"><span class="mb-1 block text-mute">Horário (ex.: 08-22; vazio = qualquer)</span>
                        <input class="field" [value]="r.hours" (input)="set(i, { hours: $any($event.target).value.trim() })" placeholder="qualquer hora"></label>
                    </div>
                  }
                </div>
              }
            </div>
            <button type="button" class="mt-2 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] text-mute hover:bg-raise hover:text-text" (click)="add()">
              <app-icon name="plus" [size]="14" />Coluna</button>
          } @else {
            <p class="mt-6 rounded-2xl border border-dashed border-edge px-5 py-5 text-center text-[13.5px] text-mute">
              Este projeto usa o quadro padrão (Backlog, A fazer, Fazendo, Revisão, Feito). Escolha um modelo para personalizar.</p>
          }
        </div>

        <footer class="flex items-center gap-3 border-t border-edge px-8 py-4">
          @if (hadBoard()) {
            <button type="button" class="btn btn-ghost text-mute" (click)="reset()" title="As tarefas voltam para as colunas padrão do mesmo tipo">Voltar ao quadro padrão</button>
          }
          @if (error()) { <p role="alert" class="text-[13px] text-no">{{ error() }}</p> }
          <span class="flex-1"></span>
          <button type="button" class="btn btn-ghost" (click)="close()">Cancelar</button>
          <button class="btn btn-primary" [disabled]="busy() || !rows().length">Salvar workflow</button>
        </footer>
      </form>
    </dialog>
  `,
})
export class BoardEditor {
  private readonly boards = inject(BoardService);
  private readonly agents = inject(AgentsService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly project = input.required<Project>();
  readonly closed = output<void>();

  protected readonly templates = BOARD_TEMPLATES;
  protected readonly kinds = KINDS;
  protected readonly rows = signal<Row[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly agentList = computed(() => this.agents.agents().filter(a => !a.builtin));
  protected readonly hadBoard = computed(() => (this.boards.bySlug()[this.project().slug] ?? []).length > 0);

  constructor() {
    // abre já com o quadro atual do projeto
    effect(() => {
      const cols = this.boards.bySlug()[this.project().slug];
      if (!cols || this.dlg().nativeElement.open) return;
      this.rows.set(this.toRows(cols));
      this.dlg().nativeElement.showModal();
    });
    effect(() => this.boards.ensure(this.project().slug));
  }

  private toRows(cols: BoardColumn[]): Row[] {
    return cols.map(c => ({ ...c, open: !!c.agentId, next: c.nextKey ? cols.findIndex(x => x.key === c.nextKey) : null }))
      .map(r => ({ ...r, next: r.next === -1 ? null : r.next }));
  }

  protected agentName(id: number | null): string | null { return id ? this.agents.byId().get(id)?.name ?? null : null; }

  protected useTemplate(id: string): void {
    const t = BOARD_TEMPLATES.find(x => x.id === id)!;
    if (this.rows().length && !confirm('Trocar as colunas por este modelo? (só vale quando salvar)')) return;
    const keys = t.columns.map(c => keyOf(c.label));
    this.rows.set(t.columns.map(c => ({ ...c, key: '', open: !!c.instruction, next: c.nextKey ? keys.indexOf(c.nextKey) : null })));
  }

  protected set(i: number, patch: Partial<Row>): void { this.rows.update(list => list.map((r, j) => (j === i ? { ...r, ...patch } : r))); }

  protected add(): void {
    this.rows.update(list => [...list.slice(0, -1), { key: '', label: '', description: null, kind: 'doing', agentId: null, instruction: null, parallel: 1, hours: '', nextKey: null, next: null, open: true }, ...list.slice(-1)]);
  }

  protected remove(i: number): void {
    this.rows.update(list => list.filter((_, j) => j !== i).map(r => ({ ...r, next: r.next === i ? null : r.next !== null && r.next > i ? r.next - 1 : r.next })));
  }

  protected reorder(e: CdkDragDrop<Row[]>): void {
    // as setas "vai para" seguem a coluna, não a posição
    const list = [...this.rows()];
    const target = list.map(r => (r.next === null ? null : list[r.next]));
    moveItemInArray(list, e.previousIndex, e.currentIndex);
    moveItemInArray(target, e.previousIndex, e.currentIndex);
    this.rows.set(list.map((r, i) => ({ ...r, next: target[i] ? list.indexOf(target[i]!) : null })));
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const rows = this.rows();
    if (rows.some(r => !r.label.trim())) { this.error.set('Dê nome a todas as colunas.'); return; }
    // key estável para as que já existiam; as novas nascem do nome (sem repetir)
    const used = new Set<string>();
    const keys = rows.map(r => {
      let k = r.key || keyOf(r.label);
      for (let n = 2; used.has(k); n++) k = `${r.key || keyOf(r.label)}-${n}`;
      used.add(k);
      return k;
    });
    await this.persist(rows.map((r, i) => ({ ...r, key: keys[i], label: r.label.trim(), nextKey: r.next === null ? null : keys[r.next] })));
  }

  protected async reset(): Promise<void> {
    if (confirm('Voltar ao quadro padrão? As tarefas vão para as colunas padrão do mesmo tipo.')) await this.persist([]);
  }

  private async persist(cols: BoardColumn[]): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try { await this.boards.save(this.project().slug, cols); this.close(); }
    catch (err) { this.error.set((err as Error).message); }
    finally { this.busy.set(false); }
  }

  protected close(): void { this.dlg().nativeElement.close(); }
}
