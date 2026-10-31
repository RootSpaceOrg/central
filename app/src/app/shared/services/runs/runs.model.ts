import { RunEventKind, RunPermission, RunStatus } from '../../contract';

export type { RunEventKind, RunPermission, RunStatus };

export interface Run {
  id: number;
  projectSlug: string;
  proposalId: number | null;
  taskId: number | null;
  turnId: number | null;
  repoPath: string;
  repoName: string;
  worktreePath: string | null;
  branch: string | null;
  baseBranch: string | null;
  prompt: string;
  /** primeira linha do prompt */
  title: string;
  status: RunStatus;
  permission: RunPermission;
  budgetUsd: number;
  costUsd: number | null;
  prUrl: string | null;
  result: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface RunEvent {
  at: Date;
  kind: RunEventKind;
  text: string;
}

export interface NewRun {
  projectSlug: string;
  repoPath: string;
  prompt: string;
  budgetUsd: number;
  permission: RunPermission;
  proposalId: number | null;
  taskId: number | null;
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Na fila',
  preparing: 'Preparando',
  running: 'Trabalhando',
  succeeded: 'Concluído',
  failed: 'Falhou',
  killed: 'Interrompido',
};

export const isActive = (s: RunStatus) => s === 'queued' || s === 'preparing' || s === 'running';
