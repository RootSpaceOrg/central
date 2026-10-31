/**
 * Contrato entre o processo principal (electron/) e a interface.
 * DTOs = shape cru que o main devolve (snake_case, datas ISO em string).
 * Os services de domínio da interface mapeiam DTO → model.
 */

export type ProjectStatus = 'active' | 'maintenance' | 'frozen' | 'dead';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'deferred' | 'running' | 'done' | 'killed';
export type Verdict = 'approve' | 'defer' | 'reject';
export type RunStatus = 'queued' | 'preparing' | 'running' | 'succeeded' | 'failed' | 'killed';
export type RunPermission = 'edits' | 'full';
export type RunEventKind = 'system' | 'text' | 'tool' | 'result' | 'error';

export interface ProjectDto {
  slug: string;
  name: string;
  folder: string;
  status: ProjectStatus;
  color: string;
  description: string | null;
  created_at: string;
  folder_exists: boolean;
  repo_count: number;
  dirty_repos: number;
  commits_7d: number;
  commits_30d: number;
  /** commits por dia, 14 posições, a última é hoje */
  spark: number[];
  last_commit_at: string | null;
  last_commit_subject: string | null;
  last_commit_repo: string | null;
  open_proposals: number;
  active_runs: number;
}

export interface NewProjectInput {
  name: string;
  folder: string;
  status: ProjectStatus;
  color: string;
  description: string | null;
}

export interface ProjectPatch {
  name?: string;
  status?: ProjectStatus;
  color?: string;
  description?: string | null;
}

export interface RepoDto {
  path: string;
  project_slug: string;
  name: string;
  remote: string | null;
  default_branch: string | null;
  branch: string | null;
  dirty: number;
  ahead: number;
  behind: number;
  last_commit_at: string | null;
  last_commit_subject: string | null;
}

export interface CommitDto {
  repo_path: string;
  repo_name: string;
  project_slug: string;
  sha: string;
  committed_at: string;
  author: string;
  subject: string;
}

export interface ProposalDto {
  id: number;
  project_slug: string | null;
  title: string;
  body: string | null;
  tier: number | null;
  est_attention_min: number | null;
  next_action: string | null;
  status: ProposalStatus;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface NewProposalInput {
  title: string;
  body: string | null;
  project_slug: string | null;
}

export interface RunDto {
  id: number;
  project_slug: string;
  proposal_id: number | null;
  task_id: number | null;
  turn_id: number | null;
  repo_path: string;
  repo_name: string;
  worktree_path: string | null;
  branch: string | null;
  base_branch: string | null;
  prompt: string;
  status: RunStatus;
  permission: RunPermission;
  budget_usd: number;
  cost_usd: number | null;
  pr_url: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface NewRunInput {
  project_slug: string;
  repo_path: string;
  prompt: string;
  budget_usd: number;
  permission: RunPermission;
  proposal_id: number | null;
  task_id?: number | null;
}

// ---------- uso do Claude ----------

export interface UsageLimitDto {
  kind: string;
  /** "Sessão", "Semana", nome do modelo */
  label: string;
  percent: number;
  severity: string;
  resets_at: string | null;
}

export interface UsageDto {
  limits: UsageLimitDto[];
  fetched_at: string;
  /** motivo quando não deu para ler (login expirado, offline) */
  error: string | null;
}

// ---------- ideias e backlog ----------

export type IdeaStatus = 'new' | 'promoted' | 'archived';
export type TaskColumn = 'backlog' | 'todo' | 'doing' | 'review' | 'done';
export type TaskPriority = 0 | 1 | 2 | 3;

export interface IdeaDto {
  id: number;
  project_slug: string | null;
  title: string;
  body: string | null;
  status: IdeaStatus;
  source: string;
  source_ref: string;
  task_id: number | null;
  created_at: string;
}

export interface NewIdeaInput {
  title: string;
  body: string | null;
  project_slug: string | null;
}

export interface IdeaPatch {
  title?: string;
  body?: string | null;
  project_slug?: string | null;
  status?: IdeaStatus;
}

export interface TaskDto {
  id: number;
  project_slug: string;
  /** repositório onde um agente trabalharia nesta tarefa */
  repo_path: string | null;
  title: string;
  body: string | null;
  column: TaskColumn;
  priority: TaskPriority;
  position: number;
  pr_url: string | null;
  proposal_id: number | null;
  idea_id: number | null;
  /** última execução de agente desta tarefa */
  run_id: number | null;
  run_status: RunStatus | null;
  created_at: string;
  updated_at: string;
}

export interface NewTaskInput {
  project_slug: string;
  repo_path: string | null;
  title: string;
  body: string | null;
  column: TaskColumn;
  priority: TaskPriority;
}

export interface TaskPatch {
  repo_path?: string | null;
  title?: string;
  body?: string | null;
  project_slug?: string;
  column?: TaskColumn;
  priority?: TaskPriority;
  /** posição dentro da coluna (0 = topo) */
  position?: number;
}

export interface ImportResultDto {
  ideas: number;
  tasks: number;
  sources: string[];
}

// ---------- turno ----------

export type TurnStatus = 'running' | 'done' | 'stopped';

export interface TurnDto {
  id: number;
  project_slug: string;
  until: string;
  budget_usd: number;
  status: TurnStatus;
  created_at: string;
  finished_at: string | null;
  runs: number;
  succeeded: number;
  failed: number;
  prs: number;
  cost_usd: number;
}

export interface NewTurnInput {
  project_slug: string;
  items: { task_id: number; repo_path: string }[];
  until: string;
  budget_usd: number;
  permission: RunPermission;
}

export interface RunEventDto {
  run_id: number;
  at: string;
  kind: RunEventKind;
  text: string;
}

export interface FsEntryDto {
  name: string;
  path: string;
  dir: boolean;
}

export interface FileDto {
  path: string;
  content: string | null;
  /** motivo quando content é null (binário, grande demais) */
  reason: string | null;
}

export interface GithubRepoDto {
  full_name: string;
  description: string | null;
  pushed_at: string;
  url: string;
}

export interface CloneProgressDto {
  full_name: string;
  state: 'cloning' | 'done' | 'error';
  message: string | null;
}

export interface AppInfoDto {
  home: string;
  dev_root: string;
  db_path: string;
  version: string;
}

export interface NewTerminalInput {
  cwd: string;
  /** 'shell' abre PowerShell; 'claude' abre uma sessão interativa do Claude Code */
  kind: 'shell' | 'claude';
  cols: number;
  rows: number;
}

export interface UpdateInfoDto {
  current: string;
  /** maior versão disponível acima da atual, ou null */
  latest: string | null;
  installer_path: string | null;
  built_at: string | null;
  source_dir: string;
  source_exists: boolean;
  building: boolean;
}

/** invoke(canal, ...args) → Promise<retorno> */
export interface Api {
  'app:info': () => AppInfoDto;
  'projects:list': () => ProjectDto[];
  'projects:create': (input: NewProjectInput) => ProjectDto;
  'projects:update': (slug: string, patch: ProjectPatch) => void;
  'projects:sync': (slug: string | null) => void;
  'repos:list': (slug: string) => RepoDto[];
  'commits:recent': (slug: string | null, days: number, limit: number) => CommitDto[];
  'proposals:list': (statuses: ProposalStatus[]) => ProposalDto[];
  'proposals:create': (input: NewProposalInput) => ProposalDto;
  'proposals:decide': (id: number, verdict: Verdict, reason: string | null) => void;
  'runs:list': (slug: string | null) => RunDto[];
  'runs:start': (input: NewRunInput) => RunDto;
  'runs:kill': (id: number) => void;
  'runs:events': (id: number) => RunEventDto[];
  'fs:list': (dir: string) => FsEntryDto[];
  'fs:read': (path: string) => FileDto;
  'fs:write': (path: string, content: string) => void;
  'pty:create': (input: NewTerminalInput) => number;
  'pty:write': (id: number, data: string) => void;
  'pty:resize': (id: number, cols: number, rows: number) => void;
  'pty:kill': (id: number) => void;
  'github:repos': () => GithubRepoDto[];
  'github:clone': (fullName: string, folder: string) => void;
  'shell:reveal': (path: string) => void;
  'shell:vscode': (path: string) => void;
  'shell:external': (url: string) => void;
  'dialog:folder': (defaultPath: string) => string | null;
  'usage:get': (force: boolean) => UsageDto;
  'ideas:list': () => IdeaDto[];
  'ideas:create': (input: NewIdeaInput) => IdeaDto;
  'ideas:update': (id: number, patch: IdeaPatch) => void;
  'ideas:promote': (id: number, projectSlug: string) => TaskDto;
  'ideas:import': () => ImportResultDto;
  'tasks:list': (slug: string | null) => TaskDto[];
  'tasks:create': (input: NewTaskInput) => TaskDto;
  'tasks:update': (id: number, patch: TaskPatch) => void;
  'tasks:delete': (id: number) => void;
  'turns:list': () => TurnDto[];
  'turns:start': (input: NewTurnInput) => TurnDto;
  'turns:stop': (id: number) => void;
  'settings:get': (key: string) => string | null;
  'settings:set': (key: string, value: string) => void;
  'update:check': () => UpdateInfoDto;
  'update:install': () => void;
  'update:build': () => void;
}

/** eventos main → interface */
export interface Events {
  'pty:data': { id: number; data: string };
  'pty:exit': { id: number; code: number };
  'run:event': RunEventDto;
  'run:update': RunDto;
  'projects:changed': null;
  /** ideias, tarefas ou turnos mudaram no main (agente terminou, importação, turno) */
  'backlog:changed': null;
  'update:log': { line: string };
  'update:built': { ok: boolean; message: string };
  'clone:progress': CloneProgressDto;
}
