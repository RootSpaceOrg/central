import { ProjectIconKind, ProjectStatus } from '../../contract';

export type { ProjectIconKind, ProjectStatus };

export interface Project {
  slug: string;
  name: string;
  folder: string;
  status: ProjectStatus;
  color: string;
  description: string | null;
  iconKind: ProjectIconKind;
  iconValue: string | null;
  folderExists: boolean;
  repoCount: number;
  dirtyRepos: number;
  commits7d: number;
  commits30d: number;
  spark: number[];
  lastCommitAt: Date | null;
  lastCommitSubject: string | null;
  lastCommitRepo: string | null;
  openProposals: number;
  activeRuns: number;
  /** subprojeto (frente) de um projeto-grupo */
  parentSlug: string | null;
  position: number;
  /** responsável pelo "A fazer" (agente que pega as tarefas), quantas por vez e horário ("08-22") */
  todoAgentId: number | null;
  todoParallel: number;
  todoHours: string;
  /** pronto = PR mergeado ('merge') ou em produção ('prod', com a coluna Em dev) */
  doneWhen: 'merge' | 'prod';
  /** o dono acorda sozinho pelos eventos do projeto */
  ownerOn: boolean;
  /** dono de negócio (fala com você); null = quem executa (todoAgentId, o tech lead) faz os dois papéis */
  ownerAgentId: number | null;
  /** dev publicado e como entrar (o teste de usuário das histórias usa) */
  devUrl: string | null;
  devLogin: string | null;
}

/** uma passada do dono: o diário (o que fez e por quê) */
export interface OwnerPass { runId: number; status: string; at: Date; title: string; diary: string | null }
export interface OwnerEvent { id: number; kind: string; summary: string; at: Date }
export interface OperatorAction { id: number; at: Date; action: string; target: string; context: string | null; reason: string | null }
export interface OwnerState { on: boolean; diary: OwnerPass[]; pending: OwnerEvent[]; actions: OperatorAction[] }

export interface Repo {
  path: string;
  name: string;
  /** URL do GitHub, quando o remote é do GitHub */
  url: string | null;
  defaultBranch: string | null;
  branch: string | null;
  dirty: number;
  ahead: number;
  behind: number;
  lastCommitAt: Date | null;
  lastCommitSubject: string | null;
}

export interface NewProject {
  parentSlug?: string | null;
  name: string;
  folder: string;
  status: ProjectStatus;
  color: string;
  description: string;
}

export interface ProjectEdit {
  doneWhen?: 'merge' | 'prod';
  name?: string;
  status?: ProjectStatus;
  color?: string;
  description?: string | null;
  iconKind?: ProjectIconKind;
  iconValue?: string | null;
  folder?: string;
  parentSlug?: string | null;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Ativo',
  maintenance: 'Manutenção',
  frozen: 'Congelado',
  dead: 'Morto',
};

export const PROJECT_COLORS = ['#3FBF8A', '#7FA2FF', '#E0B44C', '#F07167', '#B48CFF', '#4CC9F0', '#FF9F68', '#9AA5B8'];
