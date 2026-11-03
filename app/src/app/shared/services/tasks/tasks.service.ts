import { Injectable, inject, signal } from '@angular/core';

import { RunStatus, TaskColumn, TaskDto, TaskPriority } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { TasksApiService } from './tasks-api.service';

export type { TaskColumn, TaskPriority };

export interface Task {
  id: number;
  /** null = pedido solto de um quadro */
  projectSlug: string | null;
  repoPath: string | null;
  title: string;
  body: string | null;
  column: TaskColumn;
  /** cor do cartão (null = padrão) */
  color: string | null;
  priority: TaskPriority;
  position: number;
  prUrl: string | null;
  proposalId: number | null;
  ideaId: number | null;
  runId: number | null;
  runStatus: RunStatus | null;
  updatedAt: Date;
}

export interface TaskDraft {
  projectSlug: string;
  repoPath: string | null;
  title: string;
  body: string;
  column: TaskColumn;
  priority: TaskPriority;
}

export const COLUMNS: { id: TaskColumn; label: string; hint: string }[] = [
  { id: 'backlog', label: 'Backlog', hint: 'Ainda não decidido quando' },
  { id: 'todo', label: 'A fazer', hint: 'Pronto para pegar ou mandar para um agente' },
  { id: 'doing', label: 'Fazendo', hint: 'Com você ou com um agente' },
  { id: 'review', label: 'Revisão', hint: 'PR aberto esperando seu olhar' },
  { id: 'dev', label: 'Em dev', hint: 'Mergeado em develop, esperando produção' },
  { id: 'done', label: 'Feito', hint: '' },
];

export const PRIORITY: Record<TaskPriority, { label: string; tone: string }> = {
  0: { label: 'Prioritária', tone: 'text-later' },
  1: { label: 'Alta', tone: 'text-later' },
  2: { label: 'Normal', tone: 'text-mute' },
  3: { label: 'Baixa', tone: 'text-faint' },
};

const toModel = (d: TaskDto): Task => ({
  id: d.id, projectSlug: d.project_slug, repoPath: d.repo_path, title: d.title, body: d.body, column: d.column, color: d.color ?? null,
  priority: d.priority, position: d.position, prUrl: d.pr_url, proposalId: d.proposal_id, ideaId: d.idea_id,
  runId: d.run_id, runStatus: d.run_status, updatedAt: new Date(d.updated_at),
});

/** Todas as tarefas de projetos vivos; telas filtram por projeto. */
@Injectable({ providedIn: 'root' })
export class TasksService {
  private readonly api = inject(TasksApiService);

  readonly tasks = signal<Task[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.api.onChanged(() => this.load());
    this.load();
  }

  load(): void {
    this.api.list(null)
      .then(list => { this.tasks.set(list.map(toModel)); this.loaded.set(true); })
      .catch(e => this.error.set(errorMessage(e)));
  }

  /** Pedido feito direto num quadro (projeto opcional): entra na coluna pedida ou na primeira. */
  async request(boardId: number, title: string, projectSlug: string | null, stage: string | null = null, body: string | null = null): Promise<void> {
    try {
      await this.api.create({ project_slug: projectSlug, board_id: boardId, stage, repo_path: null, title, body, column: 'backlog', priority: 2 });
      this.load();
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  async create(d: TaskDraft): Promise<void> {
    await this.api.create({
      project_slug: d.projectSlug, repo_path: d.repoPath, title: d.title, body: d.body || null, column: d.column, priority: d.priority,
    });
  }

  async save(id: number, d: TaskDraft): Promise<void> {
    // pedido solto de um quadro continua sem projeto se você não escolher um
    await this.api.update(id, { project_slug: d.projectSlug || undefined, repo_path: d.repoPath, title: d.title, body: d.body || null, priority: d.priority });
    if (this.tasks().find(t => t.id === id)?.column !== d.column) await this.api.update(id, { column: d.column, position: 0 });
  }

  /** Arrastar no quadro: atualiza já na tela e confirma no banco. */
  move(id: number, column: TaskColumn, position: number): void {
    this.tasks.update(list => {
      const moved = list.find(t => t.id === id);
      if (!moved) return list;
      const rest = list.filter(t => t.id !== id);
      const inCol = rest.filter(t => t.column === column);
      inCol.splice(position, 0, { ...moved, column });
      inCol.forEach((t, i) => (t.position = i));
      return [...rest.filter(t => t.column !== column), ...inCol];
    });
    this.api.update(id, { column, position }).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  /** cor do cartão (null = padrão): vale no backlog principal e em todos os quadros */
  setColor(id: number, color: string | null): void {
    this.tasks.update(list => list.map(t => (t.id === id ? { ...t, color } : t)));
    this.api.update(id, { color }).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  remove(id: number): void {
    this.tasks.update(list => list.filter(t => t.id !== id));
    this.api.remove(id).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }
}
