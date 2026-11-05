import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TaskColumn } from '../../../../shared/contract';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { BoardColumn, BoardService, COLORS, KIND_LABEL, blankColumn } from '../../../../shared/services/board/board.service';
import { AgentSelect } from '../../../../shared/components/pickers/agent-select';
import { ContextMenuService } from '../../../../shared/services/context-menu/context-menu.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { Task, TasksService } from '../../../../shared/services/tasks/tasks.service';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Select, SelectOption } from '../../../../shared/ui/select';
import { BoardOverview } from './components/board-overview/board-overview';

import { AskService } from '../../../../shared/services/ask/ask.service';
/**
 * Um quadro (workflow): colunas com o agente de cada uma. As tarefas aqui também estão no backlog principal do projeto
 * delas (o selo mostra em que estado); pedidos podem nascer aqui, até sem projeto. "+ coluna" no fim; o botão de agente
 * em cada coluna diz quem pega o que entra nela e para onde vai depois. Visão geral: todas as colunas numa tabela.
 */
@Component({
  selector: 'app-board-page',
  imports: [RouterLink, Icon, ProjectAvatar, AgentSelect, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder, BoardOverview, Select],
  templateUrl: './board-page.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class BoardPage {
  private readonly ask = inject(AskService);
  protected readonly boards = inject(BoardService);
  protected readonly tasks = inject(TasksService);
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly agents = inject(AgentsService);
  private readonly proposals = inject(ProposalsService);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap);

  protected readonly kindLabel = KIND_LABEL;
  protected readonly kinds = Object.entries(KIND_LABEL).map(([id, label]) => ({ id: id as TaskColumn, label }));
  protected readonly id = computed(() => Number(this.params()?.get('id')));
  protected readonly board = computed(() => this.boards.byId().get(this.id()) ?? null);
  protected readonly project = computed(() => { const s = this.board()?.projectSlug; return s ? this.projects.bySlug().get(s) ?? null : null; });
  /** coluna com o painel do agente aberto */
  protected readonly agentPanel = signal<string | null>(null);
  protected readonly addingColumn = signal(false);
  protected readonly overview = signal(false);
  protected readonly colors = COLORS;
  /** coluna com o seletor de cor aberto */
  protected readonly colorPanel = signal<string | null>(null);
  private readonly menu = inject(ContextMenuService);
  /** listas de cartões (para ligar só elas entre si; a de colunas fica de fora) */
  protected readonly cardLists = computed(() => (this.board()?.columns ?? []).map(c => `cards-${c.key}`));
  protected readonly error = signal<string | null>(null);
  protected readonly asking = computed(() => new Map(this.proposals.inbox().filter(p => p.taskId).map(p => [p.taskId!, p])));

  /** tarefas por coluna (na ordem do quadro) */
  protected readonly byColumn = computed(() => {
    const b = this.board();
    if (!b) return {} as Record<string, Task[]>;
    const byId = new Map(this.tasks.tasks().map(t => [t.id, t]));
    const here = this.boards.placements().filter(p => p.boardId === b.id).sort((x, y) => x.position - y.position);
    return Object.fromEntries(b.columns.map(c => [c.key, here.filter(p => p.stage === c.key).map(p => byId.get(p.taskId)).filter((t): t is Task => !!t)]));
  });

  /** tarefas abertas que ainda não estão neste quadro (para trazer) */
  protected readonly outside = computed(() => {
    const here = new Set(this.boards.placements().filter(p => p.boardId === this.id()).map(p => p.taskId));
    const slug = this.board()?.projectSlug;
    return this.tasks.tasks().filter(t => !here.has(t.id) && t.column !== 'done').sort((a, b) => Number(b.projectSlug === slug) - Number(a.projectSlug === slug)).slice(0, 80);
  });
  protected readonly outsideOptions = computed<SelectOption[]>(() =>
    this.outside().map(t => ({ value: String(t.id), label: `${this.projectOf(t.projectSlug)?.name ?? 'sem projeto'} · ${t.title}` })));
  /** "depois vai para" de cada coluna: a próxima ou qualquer outra */
  protected readonly nextOptions = computed(() => {
    const cols = this.board()?.columns ?? [];
    return new Map(cols.map(c => [c.key, [{ value: '', label: 'a próxima coluna' }, ...cols.filter(o => o.key !== c.key).map(o => ({ value: o.key, label: o.label }))]]));
  });
  protected readonly parallels: SelectOption[] = [1, 2, 3, 4].map(n => ({ value: String(n), label: String(n) }));

  protected agentOf(id: number | null) { return id ? this.agents.byId().get(id) ?? null : null; }

  protected agentName(id: number | null): string | null { return id ? this.agents.byId().get(id)?.name ?? null : null; }
  protected projectOf(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  /** para onde a coluna manda quando o agente termina (a escolhida ou a próxima) */
  protected nextLabel(c: BoardColumn, i: number): string {
    const cols = this.board()!.columns;
    return (c.nextKey ? cols.find(x => x.key === c.nextKey)?.label : cols[i + 1]?.label) ?? 'fica aqui (é a última)';
  }

  // ---------- colunas ----------
  private save(cols: BoardColumn[]): void {
    this.error.set(null);
    this.boards.saveColumns(this.id(), cols).catch(e => this.error.set((e as Error).message));
  }

  protected patchColumn(key: string, patch: Partial<BoardColumn>): void {
    this.save(this.board()!.columns.map(c => (c.key === key ? { ...c, ...patch } : c)));
  }

  protected addColumn(label: string): void {
    if (!this.addingColumn()) return; // Enter e o blur que vem logo depois: uma coluna só
    const name = label.trim();
    this.addingColumn.set(false);
    if (name) this.save([...this.board()!.columns, blankColumn(name)]);
  }

  protected async removeColumn(c: BoardColumn): Promise<void> {
    const n = this.byColumn()[c.key]?.length ?? 0;
    if (this.board()!.columns.length < 2) { this.error.set('O quadro precisa de pelo menos uma coluna.'); return; }
    const ok = await this.ask.confirm(`Excluir a coluna "${c.label}"?`, {
      message: n ? `${n === 1 ? 'A tarefa dela vai' : `As ${n} tarefas dela vão`} para a primeira coluna do quadro. Nenhuma tarefa é apagada.`
        : 'A coluna está vazia.' + (c.agentId ? ' O agente dela deixa de cuidar desta etapa.' : ''),
      confirmLabel: 'Excluir coluna', danger: true,
    });
    if (!ok) return;
    this.save(this.board()!.columns.filter(x => x.key !== c.key).map(x => (x.nextKey === c.key ? { ...x, nextKey: null } : x)));
  }

  /** pílula "Backlog: X": em que estado a tarefa fica no backlog principal ao entrar nesta coluna */
  protected kindMenu(e: MouseEvent, c: BoardColumn): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.open(new MouseEvent('click', { clientX: r.left, clientY: r.bottom + 4 }), [
      { label: 'Não muda o backlog', icon: 'close', hint: !c.kind ? 'atual' : undefined, run: () => this.patchColumn(c.key, { kind: null }) },
      null,
      ...this.kinds.map(k => ({ label: k.label, icon: 'kanban' as const, hint: c.kind === k.id ? 'atual' : undefined, run: () => this.patchColumn(c.key, { kind: k.id }) })),
    ]);
  }

  protected async rename(c: BoardColumn): Promise<void> {
    const label = (await this.ask.text('Nome da coluna', c.label))?.trim();
    if (label && label !== c.label) this.patchColumn(c.key, { label });
  }

  protected async describe(c: BoardColumn): Promise<void> {
    const d = await this.ask.text(`Descrição de "${c.label}"`, c.description ?? '', {
      message: 'Para que serve esta coluna. Os agentes do quadro leem.', multiline: true, placeholder: 'Ex.: roteiro aprovado, esperando a arte' });
    if (d !== null) this.patchColumn(c.key, { description: d.trim() || null });
  }

  /** arrastou a coluna: nova ordem */
  protected moveColumn(e: CdkDragDrop<unknown>): void {
    if (e.previousIndex === e.currentIndex) return;
    const cols = [...this.board()!.columns];
    moveItemInArray(cols, e.previousIndex, e.currentIndex);
    this.save(cols);
  }

  // ---------- tarefas ----------
  /** botão direito no cartão: abrir, cor, tirar do quadro */
  protected cardMenu(e: MouseEvent, t: Task): void {
    this.menu.open(e, [
      { label: 'Abrir', icon: 'edit', run: () => this.dialogs.editTask(t.id) },
      null,
      ...COLORS.map(k => ({ label: k.label, swatch: k.value, hint: t.color === k.value ? 'atual' : undefined, run: () => this.tasks.setColor(t.id, k.value) })),
      ...(t.color ? [{ label: 'Cor padrão', icon: 'close' as const, run: () => this.tasks.setColor(t.id, null) }] : []),
      null,
      { label: 'Tirar deste quadro', icon: 'close', danger: true, run: () => this.boards.unplace(t.id, this.id()) },
    ]);
  }

  protected drop(e: CdkDragDrop<string, string, Task>): void {
    if (e.previousContainer === e.container && e.previousIndex === e.currentIndex) return;
    this.boards.place(e.item.data.id, this.id(), e.container.data, e.currentIndex);
  }

  protected async request(el: HTMLInputElement, stage: string): Promise<void> {
    const title = el.value.trim();
    if (!title) return;
    try {
      await this.tasks.request(this.id(), title, this.board()!.projectSlug, stage);
      el.value = '';
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  protected bring(taskId: string): void {
    if (taskId) this.boards.place(Number(taskId), this.id(), this.board()!.columns[0].key, 0);
  }
}
