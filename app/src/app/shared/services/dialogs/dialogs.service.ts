import { Injectable, signal } from '@angular/core';

export type ProjectDialogState = { mode: 'create' } | { mode: 'clone'; slug: string };

export interface RunDialogState {
  projectSlug?: string | null;
  repoPath?: string;
  prompt?: string;
  proposalId?: number | null;
  taskId?: number | null;
}

export type TaskDialogState =
  | { mode: 'create'; projectSlug?: string | null; column?: import('../../contract').TaskColumn; title?: string; body?: string }
  | { mode: 'edit'; id: number };

export interface TurnDialogState {
  projectSlug?: string | null;
}

/** Qual diálogo está aberto. Os diálogos vivem no shell do app; qualquer tela pode abri-los. */
@Injectable({ providedIn: 'root' })
export class DialogsService {
  readonly project = signal<ProjectDialogState | null>(null);
  readonly run = signal<RunDialogState | null>(null);
  readonly task = signal<TaskDialogState | null>(null);
  readonly turn = signal<TurnDialogState | null>(null);
  readonly update = signal(false);

  newProject() { this.project.set({ mode: 'create' }); }
  cloneInto(slug: string) { this.project.set({ mode: 'clone', slug }); }
  newRun(state: RunDialogState = {}) { this.run.set(state); }
  newTask(state: Omit<Extract<TaskDialogState, { mode: 'create' }>, 'mode'> = {}) { this.task.set({ mode: 'create', ...state }); }
  editTask(id: number) { this.task.set({ mode: 'edit', id }); }
  newTurn(state: TurnDialogState = {}) { this.turn.set(state); }
}
