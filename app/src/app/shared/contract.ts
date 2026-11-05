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
  /** subprojeto (frente) de um projeto-grupo; null = projeto de primeiro nível */
  parent_slug: string | null;
  /** ordem na barra lateral (entre irmãos) */
  position: number;
  /** responsável pelo "A fazer": agente que pega as tarefas que entram em A fazer (null = ninguém) */
  todo_agent_id: number | null;
  /** quantas tarefas dele ao mesmo tempo */
  todo_parallel: number;
  /** horário em que pode disparar ("08-22"; vazio = qualquer hora) */
  todo_hours: string;
  /** quando uma tarefa está pronta: 'merge' (PR mergeado) ou 'prod' (chegou em main); com 'prod' existe a coluna Em dev */
  done_when: 'merge' | 'prod';
}

export interface NewProjectInput {
  name: string;
  folder: string;
  status: ProjectStatus;
  color: string;
  description: string | null;
  /** cria como subprojeto (frente) deste projeto */
  parent_slug?: string | null;
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
  /** colocar dentro de um projeto-grupo (null = tirar do grupo) */
  parent_slug?: string | null;
  todo_agent_id?: number | null;
  todo_parallel?: number;
  todo_hours?: string;
  done_when?: 'merge' | 'prod';
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
  /** a tarefa sobre a qual é a escolha (decidir devolve a resposta para ela, sem criar outra) */
  task_id?: number | null;
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
  /** o agente parou esperando o Gustavo (JSON: reason, fix, command); null = não está esperando */
  waiting?: string | null;
  /** 0 alta, 1 normal, 2 baixa (do agente; "urgente" vira 0) */
  priority?: number;
  /** pausada pelo freio da cota (JSON: reason, until, at); continua na fila e volta sozinha */
  paused?: string | null;
  /** registro de construção (JSON: plano, etapa, quando) */
  checkpoint?: string | null;
  /** quem pediu: execução de outro agente (notify_agent) */
  parent_run_id?: number | null;
  /** assumiu o trabalho desta execução */
  handoff_from?: number | null;
  /** motivo da pausa, quando vai retomar na mesma sessão */
  resume?: string | null;
  /** etapa de quadro */
  stage?: string | null;
  board_id?: number | null;
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

/** new = para triagem; approved = aprovada, vira insumo do backlog; doing = já tem tarefas; done = tarefas concluídas; archived = descartada */
export type IdeaStatus = 'new' | 'approved' | 'doing' | 'done' | 'archived';
export type TaskColumn = 'backlog' | 'todo' | 'doing' | 'review' | 'dev' | 'done';
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
  /** 'gustavo' ou o agente que sugeriu */
  author: string;
  approved_at: string | null;
  /** marco do roadmap a que a ideia serve */
  milestone_id: number | null;
  /** tarefas ligadas e quantas já estão feitas */
  tasks: number;
  tasks_done: number;
  /** agente de triagem pegou a ideia (null = ainda não) */
  triaged_at: string | null;
  /** recomendação do agente de triagem: "aprovar e planejar — motivo" */
  triage: string | null;
}

/** Rumo do projeto: versão atual (e quem mexeu por último). */
export interface DirectionDto {
  id: number;
  project_slug: string;
  text: string;
  author: string;
  note: string | null;
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
  milestone_id?: number | null;
  triage?: string | null;
}

export interface TaskDto {
  id: number;
  /** null = pedido solto de um quadro */
  project_slug: string | null;
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
  milestone_id: number | null;

  /** cor do cartão (null = padrão) */
  color?: string | null;
}

/** Uma coluna de um quadro (workflow). */
export interface BoardColumnDto {
  key: string;
  label: string;
  description: string | null;
  /** entrar nesta coluna põe a tarefa neste estado no backlog principal (null = não mexe lá) */
  kind: TaskColumn | null;
  /** agente (de qualquer projeto) que pega o que entra nesta coluna (null = ninguém) */
  agent_id: number | null;
  /** o que o agente faz nesta etapa */
  instruction: string | null;
  parallel: number;
  hours: string;
  /** para onde a tarefa vai quando o agente termina bem (null = a próxima coluna) */
  next_key: string | null;
  /** cor da coluna (null = padrão) */
  color?: string | null;
}

/** Quadro (workflow): independente de projeto; uma tarefa pode estar em vários. */
export interface BoardDto {
  id: number;
  name: string;
  description: string | null;
  /** projeto a que o quadro pertence (null = solto, agentes de vários projetos) */
  project_slug: string | null;
  color: string;
  position: number;
  created_at: string;
  open_tasks: number;
  columns: BoardColumnDto[];
}

/** Onde uma tarefa está num quadro. */
export interface TaskPlacementDto { task_id: number; board_id: number; stage: string; position: number }

export interface NewTaskInput {
  /** null = pedido solto, feito direto num quadro (board_id) */
  project_slug: string | null;
  /** criar já num quadro (e numa coluna dele; padrão: a primeira) */
  board_id?: number | null;
  stage?: string | null;
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
  milestone_id?: number | null;
  /** cor do cartão (null = padrão) */
  color?: string | null;
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

// ---------- contexto de código (índice, grafo e memória) ----------

export interface ContextStatusDto {
  project: string;
  files: number;
  nodes: number;
  edges: number;
  indexed_at: string | null;
  ms: number | null;
  error: string | null;
  indexing: boolean;
  done: number;
  total: number;
}

export interface GraphNodeDto {
  key: string;
  /** file | route */
  kind: string;
  label: string;
  repo: string;
  path: string;
  lang: string;
  rank: number;
  /** símbolos no arquivo */
  defs: number;
  /** fatos da memória ligados */
  facts: number;
  /** vezes que agentes tocaram (30 dias) */
  touches: number;
}

export interface GraphEdgeDto { source: string; target: string; kinds: string[]; weight: number }
export interface GraphDto { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }

export interface NodeLinkDto { key: string; label: string; kinds: string[]; confidence: number }

export interface NodeDetailDto {
  key: string;
  kind: string;
  name: string;
  qualname: string;
  signature: string | null;
  doc: string | null;
  file: string | null;
  line: number | null;
  symbols: { key: string; kind: string; qualname: string; signature: string | null; line: number | null }[];
  outgoing: NodeLinkDto[];
  incoming: NodeLinkDto[];
  preview: string | null;
  facts: FactDto[];
  touches: { how: string; at: string; run_id: number | null; chat_id: number | null }[];
}

export interface CodeHitDto { key: string; kind: string; qualname: string; signature: string | null; line: number | null; file_key: string }

export type FactKind = 'decision' | 'convention' | 'gotcha' | 'fact' | 'howto';

export interface FactDto {
  id: number;
  project_slug: string;
  kind: FactKind;
  text: string;
  source_kind: string;
  source_ref: string | null;
  author: string;
  pinned: boolean;
  status: 'active' | 'retired';
  created_at: string;
  invalidated_at: string | null;
  links: string[];
}

export interface NewFactInput {
  project_slug: string;
  kind: FactKind;
  text: string;
  links?: string[];
  pinned?: boolean;
}

// ---------- a caminho de produção (develop → main) ----------

export interface ReleaseItemDto {
  sha: string;
  at: string;
  author: string;
  title: string;
  /** número do PR (merge ou squash), null = commit direto */
  pr: number | null;
  url: string | null;
  /** nota de entrega do agente que fez o PR, se houver */
  delivery: string | null;
  task_id: number | null;
}

export interface ReleaseRepoDto {
  path: string;
  name: string;
  /** main/master (null = não achou) */
  prod: string | null;
  /** develop/dev (null = o repositório não usa) */
  dev: string | null;
  /** commits em develop que não estão em main */
  commits: number;
  items: ReleaseItemDto[];
  oldest_at: string | null;
  /** página do repositório no GitHub (null = sem remote do GitHub) */
  url: string | null;
  error: string | null;
}

// ---------- entregas e "enquanto você estava fora" ----------

export type DeliveryStatus = 'pending' | 'review' | 'info' | 'accepted' | 'adjusting' | 'discarded' | 'paused';

export interface DeliveryDto {
  id: number;
  run_id: number;
  project_slug: string | null;
  project_name: string | null;
  agent_id: number | null;
  agent_name: string | null;
  task_id: number | null;
  title: string;
  what: string;
  why: string | null;
  how_to_test: string | null;
  risks: string | null;
  /** o agente contou (report_delivery) ou a Central montou do resultado */
  explained: boolean;
  /** como a execução terminou: succeeded, failed */
  outcome: string | null;
  pr_url: string | null;
  files: number;
  additions: number;
  deletions: number;
  diff_stat: string | null;
  status: DeliveryStatus;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface DigestDto {
  since: string;
  deliveries: DeliveryDto[];
  tasks_done: { id: number; title: string; project_slug: string }[];
  roadmap: { kind: string; title: string; detail: string | null; author: string; at: string; project_slug: string }[];
  ideas: number;
  decisions: number;
  memories: number;
  runs: number;
  minutes: number;
  cost_usd: number;
}

// ---------- memória dos agentes ----------

export type MemoryKind = 'preferencia' | 'fato' | 'decisao' | 'pessoa' | 'como_fazer';

export interface MemoryDto {
  id: number;
  /** null = de todos os agentes */
  agent_id: number | null;
  kind: MemoryKind;
  text: string;
  /** 'gustavo' ou o agente que guardou */
  author: string;
  /** de onde veio (conversa/execução) */
  source: string | null;
  pinned: boolean;
  status: 'active' | 'retired';
  created_at: string;
  retired_at: string | null;
  retired_reason: string | null;
}

export interface NewMemoryInput { agent_id: number | null; kind: MemoryKind; text: string; pinned?: boolean }

// ---------- roadmap ----------

export type Horizon = 'now' | 'next' | 'later' | 'done';

export interface MilestoneDto {
  id: number;
  project_slug: string;
  title: string;
  description: string | null;
  horizon: Horizon;
  /** alvo livre: "dez", "Q1", "antes da feira" */
  target: string | null;
  position: number;
  created_at: string;
  done_at: string | null;
  /** tarefas ligadas (direto ou pelas ideias do marco) e quantas estão feitas */
  tasks: number;
  tasks_done: number;
  ideas: number;
  /** quem criou: 'gustavo' ou 'agente' */
  author: string;
  /** de onde veio / por quê (ex.: "reunião 02/11: cliente pediu X") */
  note: string | null;
}

export interface MilestoneInput { title?: string; description?: string | null; horizon?: Horizon; target?: string | null; position?: number; note?: string | null }

export interface MilestoneEventDto {
  id: number;
  milestone_id: number | null;
  /** created, moved, renamed, edited, done, deleted, linked */
  kind: string;
  title: string;
  detail: string | null;
  author: string;
  at: string;
}

// ---------- atividade ao vivo (sessões e execuções trabalhando, subagentes) ----------

export interface SubagentDto {
  /** id da chamada da ferramenta Agent */
  id: string;
  /** subagent_type (general-purpose, Explore…) */
  type: string;
  description: string;
  started_at: string;
  finished_at: string | null;
  /** o que está fazendo agora */
  step: string | null;
  steps: number;
}

/** Um item do plano que o agente declarou (lista de tarefas do Claude Code). */
export interface PlanItemDto { id: string; title: string; active: string | null; status: 'pending' | 'in_progress' | 'completed' }

export interface ActivityDto {
  /** trabalhando desde */
  started_at: string;
  /** passo atual da sessão principal */
  step: string | null;
  subagents: SubagentDto[];
  /** para onde está indo: o plano declarado, com o que está em andamento */
  plan: PlanItemDto[];
  /** etapa atual: a declarada (set_status) ou deduzida da ferramenta usada */
  phase: Phase | null;
  /** o que o agente disse que está fazendo (set_status) */
  status: AgentStatusDto | null;
}

export type Phase = 'planejando' | 'investigando' | 'construindo' | 'testando' | 'revisando' | 'entregando' | 'escrevendo' | 'esperando' | 'delegando';

export interface AgentStatusDto { phase: Phase; doing: string; task_id: number | null; task_title: string | null; at: string }

/** chat = conversa (ref = id da conversa); run = execução de agente (ref = id da execução) */
export interface LiveActivityDto extends ActivityDto { scope: 'chat' | 'run'; ref: number }

// ---------- agente Central (chat) ----------

export interface ChatDto {
  id: number;
  agent_id: number;
  /** conversa de uma sessão de projeto: trabalha na pasta do projeto e pode editar código */
  project_slug: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  /** modelo escolhido na conversa ('' = o do agente / padrão do plano) */
  model: string;
  /** nível de raciocínio (--effort): '' = padrão, low, medium, high, xhigh, max */
  effort: string;
}

/** Escolhas da conversa enviadas junto com cada mensagem (ficam salvas na conversa). */
export interface ChatOptions { model: string; effort: string }

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
  /** sala no Escritório: '' = deduzida pelo papel; gestao, eng, monitor, creative, business */
  room: string;
  /** aparência do boneco 3D (JSON: hair, acc, skin, outfit); '' = padrão */
  look: string;
  priority: AgentPriority;
  /** atuação restrita: para atender gente de fora (sem comandos nem arquivos) */
  restricted: boolean;
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
  room?: string;
  look?: string;
  /** na fila e no freio da cota: high, normal, low */
  priority?: AgentPriority;
  restricted?: boolean;
}

export type AgentPriority = 'high' | 'normal' | 'low';

export type AgentPatch = Partial<NewAgentInput>;

export interface ExtensionDto { id: string; name: string; version: string; description: string; warning?: string; installed: boolean; running: boolean }
export interface WaAccountDto {
  account: string;
  state: 'disconnected' | 'pairing' | 'connecting' | 'open';
  me: { id: string; lid: string | null; phone: string; name: string | null } | null;
  /** código de pareamento para digitar no celular */
  code: string | null;
  /** quem responde nesse número; null = a Central */
  agent_id: number | null;
  /** responde qualquer pessoa que escrever (atendimento) */
  open: boolean;
}
export interface WaStatusDto { installed: boolean; accounts: WaAccountDto[] }
export interface SttStatusDto {
  installed: boolean;
  running: boolean;
  engine: 'local' | 'openai';
  model: 'small' | 'base';
  openaiModel: string;
  hasKey: boolean;
  ext: { whisper: boolean; ffmpeg: boolean; models: { small: boolean; base: boolean }; progress: { name: string; done: number; total: number } | null; error: string | null } | null;
}
export interface WaContactDto { phone: string; name: string | null; last_in_at: string | null; last_out_at: string | null; last_text: string | null; account: string | null }

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
  /** nova ordem de um grupo de irmãos na barra lateral */
  'projects:reorder': (slugs: string[]) => void;
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
  /** tira a pausa do freio: volta assim que a cota e as vagas deixarem */
  'runs:unpause': (id: number) => void;
  /** outro agente (ou o mesmo, do zero) assume o trabalho parado, na mesma branch */
  'runs:handoff': (id: number, agentId: number | null, note: string | null) => RunDto;
  /** o Gustavo resolveu o que o agente esperava: retoma a sessão da execução de onde parou (devolve a conversa) */
  'runs:resume': (id: number, note: string | null) => number;
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
  'activity:list': () => LiveActivityDto[];
  /** null = de todos os projetos */
  'milestones:list': (projectSlug: string | null) => MilestoneDto[];
  'milestones:create': (projectSlug: string, input: MilestoneInput) => MilestoneDto;
  'milestones:update': (id: number, input: MilestoneInput) => void;
  'milestones:delete': (id: number) => void;
  /** nova ordem dentro de um horizonte */
  'milestones:reorder': (ids: number[], horizon: Horizon) => void;
  /** histórico do roadmap do projeto (mais recente primeiro) */
  'milestones:events': (projectSlug: string) => MilestoneEventDto[];
  'context:status': () => ContextStatusDto[];
  'context:reindex': (projectSlug: string, force: boolean) => void;
  'context:graph': (projectSlug: string) => GraphDto;
  'context:node': (key: string) => NodeDetailDto | null;
  'context:search': (projectSlug: string, query: string) => CodeHitDto[];
  /** o que um agente recebe no prompt para este foco (prévia na tela) */
  'context:block': (projectSlug: string, focus: string, budget: number) => string;
  /** memória de um agente, a compartilhada ('shared') ou tudo ('all'); retired inclui as esquecidas */
  /** entregas desde (ISO) e/ou num status */
  /** quadros (workflows) e onde cada tarefa está neles */
  'boards:list': () => BoardDto[];
  'boards:create': (input: { name: string; description?: string | null; project_slug?: string | null; color?: string; columns?: BoardColumnDto[] }) => BoardDto;
  'boards:update': (id: number, patch: { name?: string; description?: string | null; project_slug?: string | null; color?: string }) => void;
  'boards:delete': (id: number) => void;
  'boards:columns': (id: number, columns: BoardColumnDto[]) => BoardColumnDto[];
  'boards:stages': () => TaskPlacementDto[];
  'boards:place': (taskId: number, boardId: number, stage: string, position: number) => void;
  'boards:remove': (taskId: number, boardId: number) => void;
  'deliveries:list': (since: string | null, status: DeliveryStatus | null) => DeliveryDto[];
  'deliveries:review': (id: number, action: 'accepted' | 'adjusting' | 'discarded', note: string | null) => void;
  /** tudo o que aconteceu desde (ISO) */
  'digest:get': (since: string) => DigestDto;
  /** o que está em develop e não em main, por repositório (refresh busca o remoto) */
  'release:status': (projectSlug: string, refresh?: boolean) => ReleaseRepoDto[];
  'release:summary': () => { slug: string; repos: ReleaseRepoDto[] }[];
  'memories:list': (scope: number | 'shared' | 'all', retired?: boolean) => MemoryDto[];
  'memories:create': (input: NewMemoryInput) => MemoryDto;
  'memories:update': (id: number, patch: { text?: string; kind?: MemoryKind; pinned?: boolean; agent_id?: number | null }) => void;
  'memories:forget': (id: number, reason: string) => void;
  'memories:delete': (id: number) => void;
  'facts:list': (projectSlug: string) => FactDto[];
  'facts:create': (input: NewFactInput) => FactDto;
  'facts:update': (id: number, patch: { text?: string; kind?: FactKind; pinned?: boolean; links?: string[] }) => void;
  'facts:supersede': (id: number, reason: string, replacement: string | null) => void;
  'facts:delete': (id: number) => void;
  'facts:import': (projectSlug: string) => number;
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
  'direction:get': (projectSlug: string) => DirectionDto | null;
  'direction:history': (projectSlug: string) => DirectionDto[];
  'direction:set': (projectSlug: string, text: string, note: string | null) => DirectionDto;
  /** gestor do projeto: lê rumo, ideias aprovadas, backlog e código e organiza o backlog (execução de agente) */
  'backlog:plan': (projectSlug: string, request: string | null) => RunDto;
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
  'ext:list': () => ExtensionDto[];
  'ext:install': (id: string) => void;
  'ext:uninstall': (id: string) => void;
  'wa:status': () => WaStatusDto;
  /** vincula um número (account null = número novo): o código de 8 letras chega pelo status; devolve a conta */
  'wa:pair': (account: string | null, phone: string) => string;
  /** desconecta e esquece o número */
  'wa:logout': (account: string) => void;
  /** quem responde nesse número (null = a Central) */
  'wa:setAgent': (account: string, agentId: number | null) => void;
  /** responder qualquer pessoa que escrever nesse número (atendimento) */
  'wa:setOpen': (account: string, on: boolean) => void;
  'wa:contacts': () => WaContactDto[];
  /** extensão Transcrição: motor, modelo, chave e o que já está baixado */
  'stt:status': () => SttStatusDto;
  'stt:config': (patch: { engine?: 'local' | 'openai'; model?: 'small' | 'base'; openaiModel?: string; key?: string | null }) => void;
  /** baixa o motor local (whisper.cpp, ffmpeg, modelo) */
  'stt:prepare': () => void;
  'settings:set': (key: string, value: string) => void;
  'routines:list': () => RoutineDto[];
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
  'chat:send': (chatId: number | null, agentId: number, text: string, projectSlug?: string | null, options?: ChatOptions | null) => number;
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
  /** extensão instalada, ligada ou com status novo (WhatsApp conectou, código de pareamento) */
  'ext:changed': null;
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
  /** resposta sendo escrita (texto acumulado até agora; '' = acabou, a mensagem completa vem em chat:event) */
  'chat:stream': { chat_id: number; text: string };
  /** atividade de uma conversa/execução mudou (null = parou) */
  'activity': { scope: 'chat' | 'run'; ref: number; activity: LiveActivityDto | null };
  'routines:changed': null;
  'agents:changed': null;
  /** pedido do main (bandeja, notificação) para abrir uma tela */
  'app:navigate': string;
  /** índice ou memória de um projeto mudou */
  'context:changed': { project: string };
  'update:built': { ok: boolean; message: string };
  'clone:progress': CloneProgressDto;
}
