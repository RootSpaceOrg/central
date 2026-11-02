import { RunEventKind, RunPermission, RunScope, RunSize, RunStatus } from '../../contract';

export type { RunEventKind, RunPermission, RunScope, RunSize, RunStatus };

export interface Run {
  id: number;
  projectSlug: string | null;
  agentId: number | null;
  /** sessão do Claude Code (dá para continuar conversando) */
  sessionId: string | null;
  proposalId: number | null;
  taskId: number | null;
  turnId: number | null;
  routineId: number | null;
  scope: RunScope;
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
  /** equivalente em API (não cobrado no plano) */
  costUsd: number | null;
  /** pontos percentuais da sessão do plano que a execução consumiu */
  sessionUsed: number | null;
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
  projectSlug: string | null;
  agentId?: number | null;
  /** null = projeto inteiro */
  repoPath: string | null;
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

/** Tamanho do trabalho → limite interno de segurança (o Claude Code mede em US$ equivalente de API). */
export const SIZES: { id: RunSize; label: string; hint: string; budget: number }[] = [
  { id: 'small', label: 'Pequeno', hint: 'ajuste, análise rápida', budget: 2 },
  { id: 'medium', label: 'Médio', hint: 'uma feature ou correção', budget: 6 },
  { id: 'large', label: 'Grande', hint: 'mudança em vários arquivos', budget: 15 },
];

export const isActive = (s: RunStatus) => s === 'queued' || s === 'preparing' || s === 'running';
