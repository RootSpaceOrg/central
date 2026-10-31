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
    project_slug  text not null references projects on delete cascade,
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
    status       text not null default 'new' check (status in ('new','promoted','archived')),
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

  create table if not exists settings (
    key   text primary key,
    value text not null
  );
`);

// Colunas adicionadas depois da v0.2.
for (const [table, column, type] of [['runs', 'task_id', 'integer'], ['runs', 'turn_id', 'integer'], ['tasks', 'repo_path', 'text']]) {
  const cols = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) db.exec(`alter table ${table} add column ${column} ${type}`);
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
