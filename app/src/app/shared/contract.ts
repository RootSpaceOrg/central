/**
 * Contrato entre o processo principal (electron/) e a interface.
 * DTOs = shape cru que o main devolve (snake_case, datas ISO em string).
 * Os services de domínio da interface mapeiam DTO → model.
 */

export type ProjectStatus = 'active' | 'maintenance' | 'frozen' | 'dead';
/** letra: inicial do nome; emoji; lucide: nome de ícone do Lucide; image: data URL */
export type ProjectIconKind = 'letter' | 'emoji' | 'lucide' | 'image';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'deferred' | 'running' | 'done' | 'killed';
export type Verdict = 'approve' | 'defer' | 'reject';
export type RunStatus = 'queued' | 'preparing' | 'running' | 'succeeded' | 'failed' | 'killed';
export type RunPermission = 'edits' | 'full';
/** repo: worktree isolada que termina em PR; project: pasta do projeto inteira; workspace: pasta própria de um agente sem projeto */
export type RunScope = 'repo' | 'project' | 'workspace';
export type RunEventKind = 'system' | 'text' | 'tool' | 'result' | 'error';

export interface ProjectDto {
  slug: string;
  name: string;
  folder: string;
  status: ProjectStatus;
  color: string;
  description: string | null;
  icon_kind: ProjectIconKind;
  icon_value: string | null;
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
  /** piloto automático: de madrugada um agente pega a tarefa do topo de "A fazer" */
  autopilot: boolean;
  /** para onde o Gustavo quer levar o projeto (vai em todo prompt do piloto) */
  autopilot_brief: string;
  autopilot_mode: AutopilotMode;
}

/** tasks = só executa o que está em "A fazer"; plan = sem tarefa, planeja e propõe como decisões;
 *  trust = sem tarefa, planeja e já coloca em "A fazer" */
export type AutopilotMode = 'tasks' | 'plan' | 'trust';

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
  icon_kind?: ProjectIconKind;
  icon_value?: string | null;
  /** caminho absoluto; os repositórios são redescobertos */
  folder?: string;
  autopilot?: boolean;
  autopilot_brief?: string;
  autopilot_mode?: AutopilotMode;
}

// ---------- piloto automático ----------

/** started = agente trabalhando; waiting = já há tarefa em andamento/revisão; empty = nada em "A fazer";
 *  blocked = tarefa sem repositório; quota = cota alta */
export type PulseAction = 'started' | 'planning' | 'waiting' | 'empty' | 'blocked' | 'quota';

export interface PulseItemDto {
  slug: string;
  name: string;
  action: PulseAction;
  text: string;
  run_id?: number;
}

export interface PulseStatusDto {
  last: { at: string; manual: boolean; items: PulseItemDto[] } | null;
  /** janela da madrugada, ex.: 01:00–06:00 */
  window: string;
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
  /** null quando é de um agente sem projeto */
  project_slug: string | null;
  agent_id: number | null;
  /** sessão do Claude Code: dá para continuar conversando com ela */
  session_id: string | null;
  proposal_id: number | null;
  task_id: number | null;
  turn_id: number | null;
  routine_id: number | null;
  scope: RunScope;
  /** no escopo project é a pasta do projeto */
  repo_path: string;
  repo_name: string;
  worktree_path: string | null;
  branch: string | null;
  base_branch: string | null;
  prompt: string;
  status: RunStatus;
  permission: RunPermission;
  budget_usd: number;
  /** equivalente em API calculado pelo Claude Code; não é cobrado no plano */
  cost_usd: number | null;
  /** % da sessão do plano no início e no fim (mede o consumo real) */
  usage_start: number | null;
  usage_end: number | null;
  pr_url: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface NewRunInput {
  /** pode faltar se houver agent_id de um agente sem projeto */
  project_slug: string | null;
  agent_id?: number | null;
  /** null = projeto inteiro (sem worktree) */
  repo_path: string | null;
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
  kind: TerminalKind;
  /** Claude Code do projeto: recebe o contexto da Central */
  project_slug?: string | null;
  cols: number;
  rows: number;
}

// ---------- rotinas ----------

export type RunSize = 'small' | 'medium' | 'large';
export type ScheduleKind = 'daily' | 'interval';

export interface RoutineDto {
  id: number;
  name: string;
  agent_id: number | null;
  project_slug: string | null;
  /** null = projeto inteiro (organizar/analisar); com repo = trabalha em worktree e termina em PR */
  repo_path: string | null;
  prompt: string;
  permission: RunPermission;
  size: RunSize;
  schedule_kind: ScheduleKind;
  /** dias da semana, 0 = domingo */
  days: number[];
  time: string;
  interval_hours: number;
  /** não dispara sozinha se a sessão do plano estiver acima disso (%) */
  max_session: number;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_skipped: string | null;
  last_status: RunStatus | null;
  last_run_id: number | null;
  run_count: number;
  created_at: string;
}

export interface NewRoutineInput {
  name: string;
  agent_id?: number | null;
  project_slug: string | null;
  repo_path: string | null;
  prompt: string;
  permission: RunPermission;
  size: RunSize;
  schedule_kind: ScheduleKind;
  days: number[];
  time: string;
  interval_hours: number;
  max_session?: number;
  enabled?: boolean;
}

export type RoutinePatch = Partial<NewRoutineInput>;

// ---------- sessões do projeto ----------

export type TerminalKind = 'shell' | 'cmd' | 'bash' | 'claude';
/** 'chat' = conversa com o Claude na pasta do projeto; o resto é terminal */
export type SessionKind = TerminalKind | 'chat';

export interface SessionDto {
  id: number;
  project_slug: string;
  kind: SessionKind;
  title: string;
  chat_id: number | null;
  created_at: string;
}

/** Sessão do Claude Code achada em ~/.claude/projects (para importar num projeto). */
export interface ClaudeSessionDto {
  session_id: string;
  /** pasta onde a sessão rodou (o --resume precisa dela) */
  cwd: string;
  title: string;
  updated_at: string;
  size_kb: number;
  /** já importada: id da conversa na Central */
  imported_chat_id: number | null;
}

// ---------- agente Central (chat) ----------

export interface ChatDto {
  id: number;
  agent_id: number;
  /** conversa de uma sessão de projeto: trabalha na pasta do projeto e pode editar código */
  project_slug: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'error';

export interface ChatMessageDto {
  id: number;
  chat_id: number;
  role: ChatRole;
  text: string;
  at: string;
}

// ---------- agentes (definições) ----------

export interface AgentDto {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  icon_kind: ProjectIconKind;
  icon_value: string | null;
  /** null = não pertence a um projeto (trabalha numa pasta própria) */
  project_slug: string | null;
  /** papel e jeito de trabalhar (vira instrução de sistema) */
  instructions: string;
  /** ferramentas extras liberadas, separadas por vírgula (ex.: mcp__sentry) */
  tools: string;
  permission: RunPermission;
  /** '' = padrão do Claude Code; ou sonnet, opus, haiku */
  model: string;
  builtin: boolean;
  created_at: string;
  chats: number;
  routines: number;
  runs: number;
}

export interface NewAgentInput {
  name: string;
  description?: string | null;
  color?: string;
  icon_kind?: ProjectIconKind;
  icon_value?: string | null;
  project_slug?: string | null;
  instructions?: string;
  tools?: string[];
  permission?: RunPermission;
  model?: string;
}

export type AgentPatch = Partial<NewAgentInput>;

export interface UpdateInfoDto {
  current: string;
  /** maior versão disponível acima da atual, ou null */
  latest: string | null;
  installer_path: string | null;
  built_at: string | null;
  source_dir: string;
  source_exists: boolean;
  building: boolean;
  /** de onde vem a versão nova: pasta release local ou release no GitHub */
  source: 'local' | 'github' | null;
  /** por que não deu para consultar o GitHub (gh ausente, offline) */
  github_error: string | null;
}

export interface Prefs {
  /** fechar a janela esconde na bandeja (rotinas e agentes seguem rodando) */
  tray: boolean;
  /** abrir com o Windows, minimizado na bandeja */
  autostart: boolean;
  /** notificações do Windows quando agentes terminam, CI quebra etc. */
  notify: boolean;
}

/** invoke(canal, ...args) → Promise<retorno> */
export interface Api {
  'app:info': () => AppInfoDto;
  'window:fullscreen': (on: boolean) => void;
  'projects:list': () => ProjectDto[];
  'projects:create': (input: NewProjectInput) => ProjectDto;
  'projects:update': (slug: string, patch: ProjectPatch) => void;
  'projects:sync': (slug: string | null) => void;
  /** remove da Central (pasta e repositórios ficam no disco) */
  'projects:delete': (slug: string) => void;
  'dialog:image': () => string | null;
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
  /** null = de todos os projetos */
  'sessions:list': (projectSlug: string | null) => SessionDto[];
  'sessions:create': (projectSlug: string, kind: SessionKind, chatId?: number | null) => SessionDto;
  'sessions:update': (id: number, patch: { title?: string; chat_id?: number }) => void;
  'sessions:close': (id: number) => void;
  'claude:sessions': () => ClaudeSessionDto[];
  'claude:import': (sessionId: string, projectSlug: string) => SessionDto;
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
  'routines:list': () => RoutineDto[];
  'pulse:status': () => PulseStatusDto;
  /** projectSlug: só esse projeto ("Rodar agora" no diálogo do piloto) */
  'pulse:run': (projectSlug?: string | null) => PulseStatusDto;
  'routines:create': (input: NewRoutineInput) => RoutineDto;
  'routines:update': (id: number, patch: RoutinePatch) => void;
  'routines:delete': (id: number) => void;
  /** roda agora; devolve o id da execução */
  'routines:fire': (id: number) => number | null;
  'agents:list': () => AgentDto[];
  'agents:create': (input: NewAgentInput) => AgentDto;
  'agents:update': (id: number, patch: AgentPatch) => void;
  'agents:delete': (id: number) => void;
  /** conversas de um agente (null = todas) */
  'chat:list': (agentId: number | null) => ChatDto[];
  'chat:messages': (chatId: number) => ChatMessageDto[];
  /** manda mensagem; chatId null cria conversa nova com o agente. Devolve o id da conversa */
  'chat:send': (chatId: number | null, agentId: number, text: string, projectSlug?: string | null) => number;
  /** abre uma conversa que continua a sessão de uma execução já terminada */
  'chat:fromRun': (runId: number) => number;
  'chat:rename': (chatId: number, title: string) => void;
  'chat:stop': (chatId: number) => void;
  'chat:delete': (chatId: number) => void;
  'prefs:get': () => Prefs;
  'prefs:set': (patch: Partial<Prefs>) => Prefs;
  'update:check': (force: boolean) => UpdateInfoDto;
  'update:install': () => void;
  /** publish: também cria a release no GitHub */
  'update:build': (publish: boolean) => void;
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
  /** mensagem nova do agente Central (texto, ferramenta usada, erro) ou fim da resposta */
  'chat:event': { chat_id: number; message: ChatMessageDto | null; busy: boolean };
  'routines:changed': null;
  'agents:changed': null;
  /** pedido do main (bandeja, notificação) para abrir uma tela */
  'app:navigate': string;
  'update:built': { ok: boolean; message: string };
  'clone:progress': CloneProgressDto;
}
