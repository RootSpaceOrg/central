import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TaskColumn } from '../../../../shared/contract';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { BoardColumn, BoardService, KIND_LABEL, blankColumn } from '../../../../shared/services/board/board.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { Task, TasksService } from '../../../../shared/services/tasks/tasks.service';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { BoardOverview } from './components/board-overview/board-overview';

/**
 * Um quadro (workflow): colunas com o agente de cada uma. As tarefas aqui também estão no backlog principal do projeto
 * delas (o selo mostra em que estado); pedidos podem nascer aqui, até sem projeto. "+ coluna" no fim; o botão de agente
 * em cada coluna diz quem pega o que entra nela e para onde vai depois. Visão geral: todas as colunas numa tabela.
 */
@Component({
  selector: 'app-board-page',
  imports: [RouterLink, Icon, ProjectAvatar, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder, BoardOverview],
  templateUrl: './board-page.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class BoardPage {
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
  protected readonly agentList = computed(() => this.agents.agents().filter(a => !a.builtin));
  /** coluna com o painel do agente aberto */
  protected readonly agentPanel = signal<string | null>(null);
  protected readonly addingColumn = signal(false);
  protected readonly overview = signal(false);
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

  protected removeColumn(c: BoardColumn): void {
    const n = this.byColumn()[c.key]?.length ?? 0;
    if (this.board()!.columns.length < 2) { this.error.set('O quadro precisa de pelo menos uma coluna.'); return; }
    if (n && !confirm(`"${c.label}" tem ${n} tarefa(s): elas vão para a primeira coluna. Remover?`)) return;
    this.save(this.board()!.columns.filter(x => x.key !== c.key).map(x => (x.nextKey === c.key ? { ...x, nextKey: null } : x)));
  }

  protected rename(c: BoardColumn): void {
    const label = prompt('Nome da coluna', c.label)?.trim();
    if (label && label !== c.label) this.patchColumn(c.key, { label });
  }

  protected describe(c: BoardColumn): void {
    const d = prompt('Para que serve esta coluna (os agentes leem)', c.description ?? '');
    if (d !== null) this.patchColumn(c.key, { description: d.trim() || null });
  }

  // ---------- tarefas ----------
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
