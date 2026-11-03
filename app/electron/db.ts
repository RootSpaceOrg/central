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
  ['agents', 'room', "text not null default ''"], ['agents', 'look', "text not null default ''"],
  ['projects', 'todo_agent_id', 'integer'], ['projects', 'todo_parallel', 'integer not null default 1'], ['projects', 'todo_hours', "text not null default ''"],
  ['milestones', 'author', "text not null default 'gustavo'"], ['milestones', 'note', 'text'],
  ['projects', 'autopilot_brief', "text not null default ''"], ['projects', 'autopilot_mode', "text not null default 'tasks'"],
]) {
  const cols = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) db.exec(`alter table ${table} add column ${column} ${type}`);
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

export const all = <T>(sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params) as T[];
export const get = <T>(sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) as T | undefined;
export const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
export const now = () => new Date().toISOString();

// Execuções que estavam rodando quando o app fechou não têm mais processo.
run(`update runs set status = 'failed', result = coalesce(result, 'App fechado durante a execução.'), finished_at = ?
     where status in ('queued','preparing','running')`, now());

seed();

function seed(): void {
  if (get<{ n: number }>('select count(*) n from projects')!.n > 0) return;
  const d = (f: string) => join(DEV_ROOT, f);
  const projects: [string, string, string, string, string, string | null][] = [
    ['kultivai', 'KultivAi / MarketingPet', d('mktPlatform'), 'active', '#3FBF8A',
      'Fonte de renda. SaaS multi-tenant de conteúdo para redes sociais, com editor, IA, Instagram e cobrança.'],
    ['marketingpet-platform', 'MarketingPet Platform', d('platform'), 'active', '#FF9F68',
      'Base Laravel do MarketingPet, paralela ao mkt-platform.'],
    ['alfabetizare', 'Alfabetizare', d('Alfabetizare'), 'maintenance', '#E0B44C',
      'Cliente. Alfabetização e fluência leitora para escolas. Versão Lovable em produção, Angular + AWS em migração.'],
    ['matriztech', 'MatrizTech', d('SkillHub'), 'maintenance', '#7FA2FF',
      'Cursos gamificados do Fundamental ao Médio + livros da Coleção Tech.'],
    ['mapaedu', 'MapaEdu', d('MapaEdu'), 'active', '#4CC9F0', 'Org Alicera-Products.'],
    ['adaptclass', 'AdaptClass', d('AdaptClass'), 'active', '#B48CFF', 'Org Alicera-Products.'],
    ['central', 'Central', d('Central'), 'active', '#F07167', 'Este app.'],
    ['operacao', 'Operação', d('ops-runbook'), 'maintenance', '#9AA5B8', 'Runbook de suporte dos produtos RootSpace.'],
    ['moldes', 'Moldes', d('Templates'), 'maintenance', '#8C9BB5', 'Templates de infra e Lambda que originam os produtos.'],
    ['fabrica', 'Fábrica de templates', d('TemplateGenerator'), 'dead', '#6B7385', null],
    ['healthmarket', 'HealthMarket', d('HealthMarket'), 'dead', '#6B7385', 'Migrado para o mkt-platform.'],
    ['kultivai-legado', 'KultivAi (legado)', d('KultivAi'), 'dead', '#6B7385', 'Snapshot antigo; roda hoje como tenant do mkt-platform.'],
  ];
  for (const p of projects) {
    run('insert into projects (slug, name, folder, status, color, description) values (?,?,?,?,?,?)', ...p);
  }

  const mem = join(homedir(), '.claude', 'projects', 'C--Users-Gustavo-Development-mktPlatform', 'memory');
  const proposals: [string, string, string, number, number, string, string][] = [
    ['kultivai', 'Fechar os 6 PRs de Afiliados (Fase 1)',
      'Arquitetura decidida em agosto, PRs GUS-76 a 81 parados em review desde então. Ações manuais no Stripe ainda pendentes.',
      1, 15, 'Um agente revalida os 6 PRs contra a develop atual e monta um resumo único para você aprovar.', 'project_afiliados_fase1.md'],
    ['kultivai', 'Validar em produção a correção do Instagram 190 e do timeout de 29s',
      'No ar desde 26/08 em 4 repos, ainda sem prova com tráfego real.',
      0, 5, 'Um agente lê os logs dos últimos 30 dias e diz se o erro 190 e o timeout sumiram.', 'project_instagram_190_timeout.md'],
    ['kultivai', 'Landing page v2: commitar e publicar em dev',
      'A /lp-v2 está na branch feature/landing-page-v2 sem commit desde 18/09, com decisões de estilo já tomadas.',
      1, 10, 'Um agente commita, abre o PR para develop e manda o link do preview.', 'project_landing_page_v2.md'],
    ['matriztech', 'Validar as 360 aulas da Coleção Tech',
      'Coleção fechada em 15/08; falta a validação aula a aula e uma provocação de UI.',
      1, 20, 'Um agente gera um relatório de inconsistências por volume para você revisar só o que falhou.', 'project_colecao_tech_360_completo.md'],
  ];
  for (const [slug, title, body, tier, min, next, file] of proposals) {
    run(`insert into proposals (project_slug, title, body, tier, est_attention_min, next_action, source, source_ref)
         values (?,?,?,?,?,?,'memory',?)`, slug, title, body, tier, min, next, join(mem, file));
  }
}
