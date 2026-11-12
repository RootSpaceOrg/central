import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, SQLInputValue } from 'node:sqlite';

// --data=<pasta> usa outro banco (testes), sem tocar no seu.
const dataDir = process.argv.find(a => a.startsWith('--data='))?.slice(7);
if (dataDir) app.setPath('userData', dataDir);

export const DEV_ROOT = join(homedir(), 'Development');
export const DB_PATH = join(app.getPath('userData'), 'central.db');
/** imagens coladas nos chats */
export const CHAT_MEDIA = join(app.getPath('userData'), 'chat-media');

// Numa instalação nova a pasta ainda não existe quando o banco abre.
mkdirSync(app.getPath('userData'), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  pragma journal_mode = wal;
  pragma foreign_keys = on;

  create table if not exists projects (
    slug        text primary key,
    name        text not null,
    folder      text not null unique,
    status      text not null default 'active' check (status in ('active','maintenance','frozen','dead')),
    color       text not null,
    description text,
    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists repos (
    path           text primary key,
    project_slug   text not null references projects on delete cascade,
    name           text not null,
    remote         text,
    default_branch text,
    branch         text,
    dirty          integer not null default 0,
    ahead          integer not null default 0,
    behind         integer not null default 0,
    scanned_at     text not null
  );

  create table if not exists commits (
    repo_path    text not null references repos(path) on delete cascade,
    sha          text not null,
    committed_at text not null,  -- ISO UTC
    author       text not null,
    subject      text not null,
    primary key (repo_path, sha)
  );
  create index if not exists commits_by_date on commits (committed_at desc);

  create table if not exists proposals (
    id                integer primary key autoincrement,
    project_slug      text references projects on delete set null,
    title             text not null,
    body              text,
    tier              integer check (tier in (0,1,2)),
    est_attention_min integer,
    next_action       text,
    status            text not null default 'proposed'
                      check (status in ('proposed','approved','rejected','deferred','running','done','killed')),
    source            text not null,
    source_ref        text not null,
    created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    unique (source, source_ref)
  );

  create table if not exists decisions (
    id          integer primary key autoincrement,
    proposal_id integer not null references proposals on delete cascade,
    verdict     text not null,
    reason      text,
    decided_at  text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists runs (
    id            integer primary key autoincrement,
    project_slug  text references projects on delete set null,
    proposal_id   integer references proposals on delete set null,
    repo_path     text not null,
    worktree_path text,
    branch        text,
    base_branch   text,
    prompt        text not null,
    status        text not null default 'queued'
                  check (status in ('queued','preparing','running','succeeded','failed','killed')),
    permission    text not null check (permission in ('edits','full')),
    budget_usd    real not null,
    cost_usd      real,
    pr_url        text,
    result        text,
    created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    started_at    text,
    finished_at   text
  );

  create table if not exists run_events (
    id     integer primary key autoincrement,
    run_id integer not null references runs on delete cascade,
    at     text not null,
    kind   text not null,
    text   text not null
  );
  create index if not exists run_events_by_run on run_events (run_id, id);

  create table if not exists ideas (
    id           integer primary key autoincrement,
    project_slug text references projects on delete set null,
    title        text not null,
    body         text,
    status       text not null default 'new' check (status in ('new','approved','doing','done','archived')),
    source       text not null,
    source_ref   text not null,
    task_id      integer,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    unique (source, source_ref)
  );

  create table if not exists tasks (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    title        text not null,
    body         text,
    "column"     text not null default 'backlog' check ("column" in ('backlog','todo','doing','review','done')),
    priority     integer not null default 2 check (priority between 0 and 3),
    position     real not null default 0,
    pr_url       text,
    proposal_id  integer references proposals on delete set null,
    idea_id      integer references ideas on delete set null,
    source       text,
    source_ref   text,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    unique (source, source_ref)
  );

  create table if not exists turns (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    until        text not null,
    budget_usd   real not null,
    status       text not null default 'running' check (status in ('running','done','stopped')),
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    finished_at  text
  );

  create table if not exists routines (
    id             integer primary key autoincrement,
    name           text not null,
    project_slug   text references projects on delete set null,
    repo_path      text,
    prompt         text not null,
    permission     text not null default 'edits',
    size           text not null default 'small',
    schedule_kind  text not null default 'daily',
    days           text not null default '1,2,3,4,5',
    time           text not null default '08:00',
    interval_hours integer not null default 24,
    max_session    integer not null default 80,
    enabled        integer not null default 1,
    next_run_at    text not null,
    last_run_at    text,
    last_skipped   text,
    created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists chats (
    id         integer primary key autoincrement,
    title      text not null,
    session_id text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists chat_messages (
    id      integer primary key autoincrement,
    chat_id integer not null references chats on delete cascade,
    role    text not null,
    text    text not null,
    at      text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists agents (
    id           integer primary key autoincrement,
    slug         text not null unique,
    name         text not null,
    description  text,
    color        text not null default '#7FA2FF',
    icon_kind    text not null default 'letter',
    icon_value   text,
    project_slug text references projects on delete set null,
    instructions text not null default '',
    tools        text not null default '',
    permission   text not null default 'edits',
    model        text not null default '',
    builtin      integer not null default 0,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists sessions (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    kind         text not null,
    title        text not null,
    chat_id      integer references chats on delete set null,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  -- rumo do projeto: para onde vamos (objetivo, foco do momento, o que não fazer). Cada versão fica guardada.
  create table if not exists directions (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    text         text not null,
    author       text not null,
    note         text,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  create index if not exists directions_by_project on directions(project_slug, id);

  -- roadmap do projeto: marcos em Agora / Próximo / Depois (sem data obrigatória; alvo opcional, ex.: "dez", "Q1")
  -- Guiar projeto: uma sessão aberta por projeto/escopo; etapas 1 retrato, 2 decisões, 3 plano, 4 em andamento
  -- Estúdio → piloto automático: Rumo + Time sem o Gustavo no meio; ele vê o final (ok ou feedback)
  -- processos que uma execução deixou rodando (servidor de dev, testes): a Central derruba no fim / na revisão / no prazo
  -- decisão que vale para mais de uma tarefa (ex.: uma regra que segura vários cartões): todas esperam e recebem a resposta
  create table if not exists proposal_tasks (
    proposal_id integer not null references proposals on delete cascade,
    task_id     integer not null references tasks on delete cascade,
    primary key (proposal_id, task_id)
  );

  -- eventos de cada projeto: o que acorda o dono (dedupe pelo tipo + referência enquanto não visto)
  create table if not exists events (
    id           integer primary key autoincrement,
    project_slug text not null,
    kind         text not null,
    ref          text not null,
    summary      text not null,
    urgent       integer not null default 0,
    from_owner   integer not null default 0,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    handled_at   text,
    pass_run_id  integer
  );
  create unique index if not exists events_open on events (project_slug, kind, ref) where handled_at is null;

  -- registro do operador: o que o Gustavo fez pela tela, com o motivo (base de um futuro agente operador)
  create table if not exists operator_actions (
    id           integer primary key autoincrement,
    at           text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    action       text not null,
    target       text not null,
    project_slug text,
    context      text,
    reason       text
  );

  -- resultado dos produtos: números que os donos registram (report_metric); a tela mostra a última leitura e a direção
  create table if not exists metrics (
    id           integer primary key autoincrement,
    project_slug text not null,
    name         text not null,
    value        real not null,
    unit         text,
    note         text,
    at           text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  -- números do produto como dado: combinados no 1:1 ou propostos pelo dono; o dono mede na frequência combinada
  -- quebrou de verdade (emit_event critical): vermelho no cockpit até alguém resolver
  create table if not exists alerts (
    id           integer primary key autoincrement,
    project_slug text not null,
    ref          text not null,
    summary      text not null,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    resolved_at  text
  );

  create table if not exists metric_defs (
    id           integer primary key autoincrement,
    project_slug text not null,
    name         text not null,
    unit         text,
    how          text not null,
    every_hours  integer not null default 24,
    target       real,
    active       integer not null default 1,
    unique (project_slug, name)
  );

  create table if not exists run_procs (
    id         integer primary key autoincrement,
    run_id     integer not null,
    pid        integer not null,
    start      text not null,
    cmd        text,
    server     integer not null default 0,
    kill_after text
  );

  create table if not exists pilots (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    direct       integer not null default 0,
    status       text not null default 'running',
    stage        text not null default 'rumo',
    rumo_guide   integer not null,
    time_guide   integer,
    focus        text,
    feedback     text,
    error        text,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at   text,
    approved_at  text,
    finished_at  text
  );

  create table if not exists guides (
    id              integer primary key autoincrement,
    project_slug    text not null references projects on delete cascade,
    direct          integer not null default 0,
    status          text not null default 'open',
    step            integer not null default 1,
    phase           text not null default 'idle',
    snapshot        text not null,
    reading         text,
    cards           text,
    plan            text,
    central_chat    integer,
    strategist_chat integer,
    minutes         text,
    created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      text,
    approved_at     text,
    finished_at     text
  );

  create table if not exists milestones (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    title        text not null,
    description  text,
    horizon      text not null default 'next' check (horizon in ('now','next','later','done')),
    target       text,
    position     integer not null default 0,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    done_at      text
  );

  -- nota de entrega de cada execução (o que mudou, por quê, como testar, riscos) e a revisão do Gustavo
  -- status: pending (rodando) → review (mexeu em código) | info (não mexeu) → accepted | adjusting | discarded
  create table if not exists deliveries (
    id          integer primary key autoincrement,
    run_id      integer not null unique references runs on delete cascade,
    project_slug text,
    agent_id    integer,
    task_id     integer,
    title       text not null,
    what        text not null,
    why         text,
    how_to_test text,
    risks       text,
    explained   integer not null default 0,
    outcome     text,
    pr_url      text,
    files       integer not null default 0,
    additions   integer not null default 0,
    deletions   integer not null default 0,
    diff_stat   text,
    status      text not null default 'pending',
    review_note text,
    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    reviewed_at text
  );

  -- quadros (workflows): independentes de projeto; uma tarefa pode estar em vários, numa coluna de cada
  create table if not exists boards (
    id           integer primary key autoincrement,
    name         text not null,
    description  text,
    project_slug text references projects on delete set null,
    color        text not null default '#7FA2FF',
    position     integer not null default 0,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  create table if not exists board_cols (
    board_id     integer not null references boards on delete cascade,
    key          text not null,
    label        text not null,
    description  text,
    kind         text,
    position     integer not null default 0,
    agent_id     integer references agents on delete set null,
    instruction  text,
    parallel     integer not null default 1,
    hours        text not null default '',
    next_key     text,
    primary key (board_id, key)
  );
  create table if not exists task_boards (
    task_id    integer not null references tasks on delete cascade,
    board_id   integer not null references boards on delete cascade,
    stage      text not null,
    position   integer not null default 0,
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    primary key (task_id, board_id)
  );

  -- memória dos agentes: do agente (agent_id) ou de todos (agent_id null); esquecer retira com o motivo
  create table if not exists memories (
    id             integer primary key autoincrement,
    agent_id       integer references agents on delete cascade,
    kind           text not null,
    text           text not null,
    author         text not null default 'gustavo',
    source         text,
    pinned         integer not null default 0,
    status         text not null default 'active',
    created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    retired_at     text,
    retired_reason text
  );

  -- histórico do roadmap: quem mexeu (gustavo ou agente), o quê e por quê
  create table if not exists milestone_events (
    id           integer primary key autoincrement,
    milestone_id integer,
    project_slug text not null references projects on delete cascade,
    kind         text not null,
    title        text not null,
    detail       text,
    author       text not null default 'gustavo',
    at           text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  -- memória do projeto: fatos duráveis (decisão, convenção, armadilha…) com proveniência, ligados a nós do índice de código
  create table if not exists facts (
    id             integer primary key autoincrement,
    project_slug   text not null references projects on delete cascade,
    kind           text not null,
    text           text not null,
    source_kind    text not null,
    source_ref     text,
    author         text not null,
    pinned         integer not null default 0,
    status         text not null default 'active',
    created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    invalidated_at text,
    superseded_by  integer
  );
  create table if not exists fact_links (
    fact_id  integer not null references facts on delete cascade,
    node_key text not null,
    primary key (fact_id, node_key)
  ) without rowid;

  -- o que cada execução/conversa tocou (arquivos lidos, editados, consultados no índice)
  create table if not exists touches (
    id           integer primary key autoincrement,
    project_slug text,
    run_id       integer,
    chat_id      integer,
    node_key     text not null,
    how          text not null,
    at           text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  create index if not exists touches_by_run on touches(run_id);
  create index if not exists touches_by_project on touches(project_slug, at);

  create table if not exists wa_contacts (
    phone       text primary key,
    chat        text,
    name        text,
    last_in_at  text,
    last_out_at text,
    last_text   text
  );
  create table if not exists wa_outbox (
    id          integer primary key autoincrement,
    to_number   text not null,
    text        text not null,
    proposal_id integer,
    status      text not null default 'pending',
    created_by  text,
    error       text,
    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    sent_at     text
  );
  create table if not exists wa_feed (
    id           integer primary key autoincrement,
    account      text not null,
    chat         text not null,
    sender       text,
    text         text not null,
    at           text not null,
    run_id       integer
  );
  create table if not exists settings (
    key   text primary key,
    value text not null
  );
`);

// Colunas adicionadas depois da v0.2.
for (const [table, column, type] of [
  ['runs', 'task_id', 'integer'], ['runs', 'turn_id', 'integer'], ['tasks', 'repo_path', 'text'],
  ['projects', 'icon_kind', "text not null default 'letter'"], ['projects', 'icon_value', 'text'],
  ['runs', 'scope', "text not null default 'repo'"], ['runs', 'routine_id', 'integer'],
  ['runs', 'usage_start', 'real'], ['runs', 'usage_end', 'real'],
  ['runs', 'agent_id', 'integer'], ['runs', 'session_id', 'text'], ['routines', 'agent_id', 'integer'],
  ['chats', 'agent_id', 'integer'], ['chats', 'cwd', 'text'], ['chats', 'project_slug', 'text'],
  ['projects', 'autopilot', 'integer not null default 0'],
  ['ideas', 'author', "text not null default 'gustavo'"], ['ideas', 'approved_at', 'text'],
  ['chats', 'model', "text not null default ''"], ['chats', 'effort', "text not null default ''"],
  ['projects', 'parent_slug', 'text'],
  ['tasks', 'milestone_id', 'integer'], ['ideas', 'milestone_id', 'integer'], ['projects', 'position', 'integer not null default 0'],
  ['agents', 'room', "text not null default ''"], ['tasks', 'stage', 'text'], ['runs', 'stage', 'text'], ['runs', 'board_id', 'integer'], ['board_cols', 'color', 'text'], ['tasks', 'color', 'text'], ['proposals', 'task_id', 'integer'], ['projects', 'done_when', "text not null default 'merge'"], ['runs', 'waiting', 'text'], ['agents', 'look', "text not null default ''"],
  ['projects', 'todo_agent_id', 'integer'], ['projects', 'todo_parallel', 'integer not null default 1'], ['projects', 'todo_hours', "text not null default ''"],
  ['ideas', 'triaged_at', 'text'], ['ideas', 'triage', 'text'], ['wa_contacts', 'account', 'text'], ['wa_outbox', 'account', 'text'],
  ['agents', 'restricted', 'integer not null default 0'], ['chats', 'contact', 'text'], ['tasks', 'depends_on', 'text'], ['proposals', 'summary', 'text'], ['chats', 'add_dirs', 'text'], ['runs', 'grants', 'text'], ['runs', 'board_moved', 'integer not null default 0'], ['routines', 'kind', "text not null default 'agent'"], ['routines', 'shell', "text not null default ''"], ['routines', 'on_fail_agent', 'integer'], ['routines', 'interval_minutes', 'integer'], ['agents', 'add_dirs', 'text'], ['chats', 'allow_tools', 'text'], ['chats', 'yolo', 'integer not null default 0'], ['proposals', 'options', 'text'], ['proposals', 'agent_id', 'integer'], ['proposals', 'origin_chat', 'integer'], ['proposals', 'origin_run', 'integer'], ['guides', 'focus', 'text'], ['guides', 'kind', "text not null default 'rumo'"], ['runs', 'dismissed', 'integer not null default 0'], ['ideas', 'seen_at', 'text'], ['tasks', 'picked_at', 'text'], ['tasks', 'parent_id', 'integer'], ['projects', 'owner_on', 'integer not null default 0'], ['projects', 'dev_url', 'text'], ['projects', 'dev_login', 'text'], ['deliveries', 'video', 'text'], ['projects', 'one_on_one', 'text'], ['projects', 'owner_agent_id', 'integer'], ['proposals', 'closed_by', 'text'], ['proposals', 'closed_how', 'text'], ['proposals', 'closed_reason', 'text'], ['proposals', 'closed_at', 'text'], ['deliveries', 'closed_by', 'text'], ['deliveries', 'closed_how', 'text'], ['guides', 'tech_chat', 'integer'], ['projects', 'one_on_one_at', 'text'],
  ['agents', 'priority', "text not null default 'normal'"], ['runs', 'priority', 'integer not null default 1'],
  ['runs', 'paused', 'text'], ['runs', 'resume', 'text'], ['runs', 'checkpoint', 'text'],
  ['runs', 'parent_run_id', 'integer'], ['runs', 'depth', 'integer not null default 0'], ['runs', 'handoff_from', 'integer'],
  ['milestones', 'author', "text not null default 'gustavo'"], ['milestones', 'note', 'text'],
  ['projects', 'autopilot_brief', "text not null default ''"], ['projects', 'autopilot_mode', "text not null default 'tasks'"],
]) {
  const cols = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) db.exec(`alter table ${table} add column ${column} ${type}`);
}

// v0.26: o agente de triagem só pega ideias novas daqui em diante (as antigas contam como já vistas)
if (!db.prepare(`select 1 from settings where key = 'triage:backfill'`).get()) {
  db.exec(`update ideas set triaged_at = created_at where triaged_at is null`);
  db.exec(`insert into settings (key, value) values ('triage:backfill', '1')`);
}

// v0.6: execuções e rotinas podem não ter projeto (agente sem projeto). O SQLite não muda NOT NULL de coluna
// existente: recria a tabela com o mesmo SQL (projeto opcional), copia os dados e troca. Referências de outras
// tabelas a ela continuam valendo porque o nome final é o mesmo.
for (const table of ['runs', 'routines']) {
  const col = (db.prepare(`pragma table_info(${table})`).all() as { name: string; notnull: number }[]).find(c => c.name === 'project_slug');
  if (!col?.notnull) continue;
  const ddl = (db.prepare(`select sql from sqlite_master where type = 'table' and name = ?`).get(table) as { sql: string }).sql;
  const relaxed = ddl
    .replace(/project_slug(\s+)text not null references projects on delete cascade/i, 'project_slug$1text references projects on delete set null')
    .replace(/^CREATE TABLE\s+"?\w+"?/i, `CREATE TABLE ${table}_new`);
  db.exec('pragma foreign_keys = off');
  db.exec('begin');
  try {
    db.exec(relaxed);
    db.exec(`insert into ${table}_new select * from ${table}`);
    db.exec(`drop table ${table}`);
    db.exec(`alter table ${table}_new rename to ${table}`);
    db.exec('commit');
  } catch (e) {
    db.exec('rollback');
    throw e;
  } finally {
    db.exec('pragma foreign_keys = on');
  }
}

// v0.25: o workflow por projeto da v0.24 (board_columns + tasks.stage) vira um quadro independente ligado ao projeto.
{
  const old = db.prepare(`select name from sqlite_master where type = 'table' and name = 'board_columns'`).get();
  if (old) {
    db.exec('begin');
    try {
      const slugs = db.prepare('select distinct project_slug s from board_columns').all() as { s: string }[];
      for (const { s } of slugs) {
        const name = (db.prepare('select name from projects where slug = ?').get(s) as { name: string } | undefined)?.name ?? s;
        const id = Number(db.prepare('insert into boards (name, project_slug) values (?, ?)').run(`${name} · workflow`, s).lastInsertRowid);
        db.prepare(`insert into board_cols (board_id, key, label, description, kind, position, agent_id, instruction, parallel, hours, next_key)
          select ?, key, label, description, kind, position, agent_id, instruction, parallel, hours, next_key from board_columns where project_slug = ?`).run(id, s);
        db.prepare(`insert into task_boards (task_id, board_id, stage) select id, ?, stage from tasks where project_slug = ? and stage is not null`).run(id, s);
        db.prepare(`update runs set board_id = ? where project_slug = ? and stage is not null`).run(id, s);
      }
      db.exec('update tasks set stage = null');
      db.exec('drop table board_columns');
      db.exec('commit');
    } catch (e) { db.exec('rollback'); throw e; }
  }
}

// v0.25: tarefa pode não ter projeto (pedido feito direto num quadro sem projeto): project_slug deixa de ser NOT NULL.
{
  const ddl = (db.prepare(`select sql from sqlite_master where type = 'table' and name = 'tasks'`).get() as { sql: string }).sql;
  if (/project_slug\s+text\s+not null/i.test(ddl)) {
    const next = ddl.replace(/project_slug\s+text\s+not null/i, 'project_slug text').replace(/^CREATE TABLE\s+"?\w+"?/i, 'CREATE TABLE tasks_new');
    db.exec('pragma foreign_keys = off');
    db.exec('begin');
    try {
      db.exec(next);
      db.exec('insert into tasks_new select * from tasks');
      db.exec('drop table tasks');
      db.exec('alter table tasks_new rename to tasks');
      db.exec('commit');
    } catch (e) { db.exec('rollback'); throw e; }
    finally { db.exec('pragma foreign_keys = on'); }
  }
}

// v0.23: tarefas ganham a coluna "Em dev" (mergeado em develop, esperando produção). O CHECK antigo não aceita:
// recria a tabela com o mesmo SQL e o CHECK novo, copia tudo e troca (mesmo nome: referências continuam valendo).
{
  const ddl = (db.prepare(`select sql from sqlite_master where type = 'table' and name = 'tasks'`).get() as { sql: string }).sql;
  if (!ddl.includes("'dev'")) {
    const next = ddl.replace(/check \("column" in \([^)]*\)\)/i, `check ("column" in ('backlog','todo','doing','review','dev','done'))`)
      .replace(/^CREATE TABLE\s+"?\w+"?/i, 'CREATE TABLE tasks_new');
    if (!next.includes("'dev'")) throw new Error('Migração das tarefas: não achei o CHECK das colunas.');
    db.exec('pragma foreign_keys = off');
    db.exec('begin');
    try {
      db.exec(next);
      db.exec('insert into tasks_new select * from tasks');
      db.exec('drop table tasks');
      db.exec('alter table tasks_new rename to tasks');
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    } finally {
      db.exec('pragma foreign_keys = on');
    }
  }
}

// v0.11: ideias ganham ciclo de vida (nova → aprovada → em andamento → feita; ou descartada). O CHECK antigo só
// aceitava new/promoted/archived: recria a tabela com o novo CHECK; "promoted" (já virou tarefa) vira "doing".
{
  const ddl = (db.prepare(`select sql from sqlite_master where type = 'table' and name = 'ideas'`).get() as { sql: string }).sql;
  if (ddl.includes("'promoted'")) {
    const next = ddl.replace(/check \(status in \([^)]*\)\)/i, "check (status in ('new','approved','doing','done','archived'))")
      .replace(/^CREATE TABLE\s+"?\w+"?/i, 'CREATE TABLE ideas_new');
    db.exec('pragma foreign_keys = off');
    db.exec('begin');
    try {
      db.exec(next);
      db.exec(`insert into ideas_new select * from ideas`);
      db.exec(`update ideas_new set status = 'doing' where status = 'promoted'`);
      db.exec('drop table ideas');
      db.exec('alter table ideas_new rename to ideas');
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    } finally {
      db.exec('pragma foreign_keys = on');
    }
  }
}

// índices das consultas quentes (depois das migrações: algumas colunas nascem nelas). Sem o de runs(task_id), a lista de
// tarefas varria todas as execuções para cada tarefa (~0,5 s travando o processo principal a cada mudança no backlog).
db.exec(`
  create index if not exists runs_by_task on runs(task_id, id);
  create index if not exists runs_by_project on runs(project_slug, created_at);
  create index if not exists runs_by_status on runs(status);
  create index if not exists runs_by_worktree on runs(worktree_path);
  create index if not exists runs_by_agent on runs(agent_id);
  create index if not exists runs_by_routine on runs(routine_id, id);
  create index if not exists chats_by_agent on chats(agent_id);
  create index if not exists routines_by_agent on routines(agent_id);
  create index if not exists tasks_by_parent on tasks(parent_id);
  create index if not exists tasks_by_project on tasks(project_slug, "column");
  create index if not exists deliveries_by_task on deliveries(task_id);
  create index if not exists deliveries_by_status on deliveries(status);
  create index if not exists proposals_by_project on proposals(project_slug, status);
  create index if not exists events_by_project on events(project_slug, handled_at);
`);

/** consultas preparadas uma vez e reaproveitadas (preparar de novo a cada chamada custa em laço quente) */
const stmts = new Map<string, ReturnType<typeof db.prepare>>();
const prep = (sql: string) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); if (stmts.size < 2000) stmts.set(sql, s); } return s; };
export const all = <T>(sql: string, ...params: SQLInputValue[]) => prep(sql).all(...params) as T[];
export const get = <T>(sql: string, ...params: SQLInputValue[]) => prep(sql).get(...params) as T | undefined;
export const run = (sql: string, ...params: SQLInputValue[]) => prep(sql).run(...params);
export const now = () => new Date().toISOString();

// Execuções que estavam rodando quando o app fechou não têm mais processo. Com sessão do Claude, ficam pausadas e a
// Central retoma sozinha na mesma sessão; sem sessão (nem chegou a começar), falham como antes. A fila continua na fila.
for (const { id } of db.prepare(`select id from runs where status = 'running' and session_id is not null`).all() as { id: number }[]) {
  db.prepare('insert into run_events (run_id, at, kind, text) values (?,?,?,?)').run(id, now(), 'system', 'A Central fechou no meio: pausada, volta sozinha na mesma sessão.');
}
run(`update runs set status = 'queued', resume = 'a Central fechou no meio da execução',
       paused = json_object('reason', 'a Central fechou no meio da execução', 'until', null, 'at', ?)
     where status = 'running' and session_id is not null`, now());
// sem sessão (caiu antes de o Claude começar): volta para a fila e recomeça do zero; comando de rotina fica como falhou
run(`update runs set status = 'queued', started_at = null where status in ('preparing','running') and session_id is null and scope <> 'command'`);
run(`update runs set status = 'failed', result = coalesce(result, 'App fechado durante a execução.'), finished_at = ?
     where status in ('preparing','running')`, now());

