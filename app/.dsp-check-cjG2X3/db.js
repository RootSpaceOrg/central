
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`
  create table agents (id integer primary key, permission text, name text, builtin integer default 0, priority text default 'normal');
  insert into agents (id, permission, name) values (6, 'full', 'Tech'), (7, 'edits', 'Pesquisador'), (8, 'edits', 'Roteirista');
  create table projects (slug text primary key, status text, todo_agent_id integer, todo_parallel integer, todo_hours text);
  insert into projects values ('kultivai', 'active', 6, 2, '08-22'), ('outro', 'active', null, 1, ''), ('conteudo', 'active', null, 1, '');
  create table runs (id integer primary key, project_slug text, agent_id integer, task_id integer, status text, finished_at text, stage text, waiting text, board_id integer);
  create table tasks (id integer primary key, project_slug text, "column" text, title text, body text, repo_path text, priority integer, position integer, stage text, pr_url text, updated_at text);
  insert into tasks values (1, 'kultivai', 'todo', 'Exportar PDF', 'detalhe', 'C:/r/front', 2, 0, null, null, null),
    (2, 'kultivai', 'todo', 'Corrigir login', null, null, 0, 1, null, null, null), (3, 'kultivai', 'todo', 'Terceira', null, null, 2, 2, null, null, null),
    (4, 'kultivai', 'backlog', 'Não é A fazer', null, null, 0, 0, null, null, null), (5, 'outro', 'todo', 'Sem responsável', null, null, 0, 0, null, null, null),
    (9, 'conteudo', 'backlog', 'Post sobre a Central', null, null, 2, 0, null, null, null),
    (10, null, 'backlog', 'Pedido solto: pesquisa de concorrentes', null, null, 2, 0, null, null, null);
  create table proposals (id integer primary key, task_id integer, status text, project_slug text, title text, body text, next_action text, tier integer, source text, source_ref text);
  create table boards (id integer primary key autoincrement, name text not null, description text, project_slug text, color text not null default '#7FA2FF', position integer not null default 0, created_at text default '2026-11-01');
  create table board_cols (board_id integer, key text, label text, description text, kind text, position integer, agent_id integer, instruction text, parallel integer, hours text, next_key text, color text, primary key (board_id, key));
  create table task_boards (task_id integer, board_id integer, stage text, position integer default 0, updated_at text, primary key (task_id, board_id));
  create table deliveries (pr_url text, title text, task_id integer);
  insert into agents (id, permission, name, builtin) values (1, 'edits', 'Central', 1);
  alter table tasks add column depends_on text;
  create table ideas (id integer primary key, title text, body text, project_slug text, status text, author text, triaged_at text);
  insert into ideas (id, title, body, project_slug, status, author) values (1, 'Solta', 'texto', null, 'new', 'gustavo'),
    (2, 'Com projeto', null, 'kultivai', 'new', 'gustavo'), (3, 'De agente', null, null, 'new', 'agente'), (4, 'Velha', null, null, 'approved', 'gustavo');
  alter table runs add column prompt text;
`);
module.exports = { db, now: () => '2026-11-02T12:00:00.000Z', all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a) };