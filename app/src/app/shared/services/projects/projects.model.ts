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
  /** piloto automático: de madrugada um agente pega a tarefa do topo de "A fazer" */
  autopilot: boolean;
}

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
  name: string;
  folder: string;
  status: ProjectStatus;
  color: string;
  description: string;
}

export interface ProjectEdit {
  name?: string;
  status?: ProjectStatus;
  color?: string;
  description?: string | null;
  iconKind?: ProjectIconKind;
  iconValue?: string | null;
  folder?: string;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Ativo',
  maintenance: 'Manutenção',
  frozen: 'Congelado',
  dead: 'Morto',
};

export const PROJECT_COLORS = ['#3FBF8A', '#7FA2FF', '#E0B44C', '#F07167', '#B48CFF', '#4CC9F0', '#FF9F68', '#9AA5B8'];
