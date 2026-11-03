
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`
  create table agents (id integer primary key, name text); insert into agents values (2, 'Marketing');
  create table projects (slug text primary key, name text); insert into projects values ('kultivai', 'KultivAi');
  create table runs (id integer primary key, project_slug text, agent_id integer, task_id integer, prompt text, status text, result text,
    pr_url text, worktree_path text, base_branch text, cost_usd real, started_at text, finished_at text);
  create table tasks (id integer primary key, title text, project_slug text, "column" text, updated_at text);
  create table milestone_events (id integer primary key, kind text, title text, detail text, author text, at text, project_slug text);
  create table ideas (id integer primary key, created_at text, status text);
  create table proposals (id integer primary key, created_at text, status text);
  create table memories (id integer primary key, created_at text, author text, status text);
  ${"create table if not exists deliveries (\n    id          integer primary key autoincrement,\n    run_id      integer not null unique references runs on delete cascade,\n    project_slug text,\n    agent_id    integer,\n    task_id     integer,\n    title       text not null,\n    what        text not null,\n    why         text,\n    how_to_test text,\n    risks       text,\n    explained   integer not null default 0,\n    outcome     text,\n    pr_url      text,\n    files       integer not null default 0,\n    additions   integer not null default 0,\n    deletions   integer not null default 0,\n    diff_stat   text,\n    status      text not null default 'pending',\n    review_note text,\n    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),\n    reviewed_at text\n  );"}
  insert into tasks values (7, 'Exportar roadmap', 'kultivai', 'review', '2026-11-01T10:00:00Z');
  insert into runs values (1, 'kultivai', 2, 7, 'Exportar o roadmap em PDF\nDetalhes', 'succeeded', 'Feito. PR aberto.', 'https://github.com/x/y/pull/3', null, null, 0.5, '2026-11-02T10:00:00Z', '2026-11-02T11:30:00Z');
  insert into runs values (2, 'kultivai', null, null, '[gestor:planejar] Você é o gestor', 'succeeded', 'Backlog organizado.', null, null, null, 0.1, '2026-11-02T12:00:00Z', '2026-11-02T12:30:00Z');
  insert into runs values (3, 'kultivai', 2, null, 'Tentar algo', 'killed', null, null, null, null, null, '2026-11-02T12:00:00Z', '2026-11-02T12:01:00Z');
  insert into milestone_events values (1, 'done', 'App abre rápido', 'Agora → Feito', 'agente', '2026-11-02T13:00:00Z', 'kultivai');
  insert into ideas values (1, '2026-11-02T09:00:00Z', 'new');
  insert into proposals values (1, '2026-11-02T09:00:00Z', 'proposed');
  insert into memories values (1, '2026-11-02T09:00:00Z', 'agente', 'active');
`);
module.exports = {
  all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a),
  now: () => '2026-11-02T14:00:00Z',
};