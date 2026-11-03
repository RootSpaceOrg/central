// Self-check do responsável pelo "A fazer" e da leitura develop → main: `node scripts/dispatch.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.dsp-check-'));
const stub = join(dir, 'db.js');
writeFileSync(stub, `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(\`
  create table agents (id integer primary key, permission text, name text);
  insert into agents values (6, 'full', 'Tech'), (7, 'edits', 'Pesquisador'), (8, 'edits', 'Roteirista');
  create table projects (slug text primary key, status text, todo_agent_id integer, todo_parallel integer, todo_hours text);
  insert into projects values ('kultivai', 'active', 6, 2, '08-22'), ('outro', 'active', null, 1, ''), ('conteudo', 'active', null, 1, '');
  create table runs (id integer primary key, project_slug text, agent_id integer, task_id integer, status text, finished_at text, stage text, waiting text);
  create table tasks (id integer primary key, project_slug text, "column" text, title text, body text, repo_path text, priority integer, position integer, stage text, pr_url text, updated_at text);
  insert into tasks values (1, 'kultivai', 'todo', 'Exportar PDF', 'detalhe', 'C:/r/front', 2, 0, null, null, null),
    (2, 'kultivai', 'todo', 'Corrigir login', null, null, 0, 1, null, null, null), (3, 'kultivai', 'todo', 'Terceira', null, null, 2, 2, null, null, null),
    (4, 'kultivai', 'backlog', 'Não é A fazer', null, null, 0, 0, null, null, null), (5, 'outro', 'todo', 'Sem responsável', null, null, 0, 0, null, null, null),
    (9, 'conteudo', 'backlog', 'Post sobre a Central', null, null, 2, 0, null, null, null);
  create table proposals (id integer primary key, task_id integer, status text);
  create table board_columns (project_slug text, key text, label text, description text, kind text, position integer, agent_id integer, instruction text, parallel integer, hours text, next_key text, primary key (project_slug, key));
  create table deliveries (pr_url text, title text, task_id integer);
\`);
module.exports = { db, now: () => '2026-11-02T12:00:00.000Z', all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a) };`);
const opts = { bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', plugins: [{ name: 'db', setup: b => b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stub, external: true })) }] };
await build({ ...opts, entryPoints: [join(root, 'electron/dispatch.ts')], outfile: join(dir, 'd.js') });
await build({ ...opts, entryPoints: [join(root, 'electron/release.ts')], outfile: join(dir, 'r.js') });
await build({ ...opts, entryPoints: [join(root, 'electron/board.ts')], outfile: join(dir, 'b.js') });
const req = createRequire(import.meta.url);
const d = req(join(dir, 'd.js'));
const r = req(join(dir, 'r.js'));
const { db } = req(stub);
const ok = (c, m) => { if (!c) throw new Error(m); };

// horário
const at = h => new Date(2026, 10, 2, h, 30);
ok(d.withinHours('08-22', at(9)) && !d.withinHours('08-22', at(23)) && !d.withinHours('08-22', at(7)), 'janela do dia');
ok(d.withinHours('22-06', at(23)) && d.withinHours('22-06', at(3)) && !d.withinHours('22-06', at(12)), 'janela virando a noite');
ok(d.withinHours('', at(4)), 'vazio = qualquer hora');

let started = [];
const deps = (quota, h = 10) => ({ quota: async () => quota, start: i => { started.push(i); db.prepare("insert into runs (project_slug, agent_id, task_id, status) values (?,?,?, 'queued')").run(i.project_slug, i.agent_id, i.task_id); }, now: () => at(h) });

ok(await d.dispatchTodo(deps(85)) === 0 && d.dispatchSkip().includes('85%'), 'cota alta não dispara');
ok(await d.dispatchTodo(deps(10, 23)) === 0, 'fora do horário não dispara');
ok(await d.dispatchTodo(deps(10)) === 2, 'dispara até o limite (2 por vez)');
ok(started[0].task_id === 2 && started[1].task_id === 1, 'prioritária primeiro');
ok(started[1].repo_path === 'C:/r/front' && started[1].prompt === 'Exportar PDF\n\ndetalhe' && started[1].permission === 'full', 'repositório, prompt e liberdade do agente');
ok(!started.some(s => s.task_id === 5 || s.task_id === 4), 'só A fazer e só projeto com responsável');
ok(await d.dispatchTodo(deps(10)) === 0, 'sem vaga: espera');

// uma termina bem, outra não termina: a vaga é usada pela terceira, e a que falhou não volta em laço
db.exec("update runs set status = 'succeeded' where task_id = 2; update tasks set \"column\" = 'review' where id = 2; update runs set status = 'failed', finished_at = '2026-11-02T12:00:00.000Z' where task_id = 1");
started = [];
ok(await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-02T13:00:00Z') }) === 1 && started[0].task_id === 3, 'vaga livre pega a próxima (a que falhou fica de fora)');
db.exec("update runs set status = 'succeeded' where task_id = 3; update tasks set \"column\" = 'review' where id = 3");
started = [];
ok(await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-03T13:00:00Z') }) === 1 && started.map(s => s.task_id).join() === '1', 'depois de 12 h tenta de novo a que falhou');

// develop → main
ok(r.webUrl('git@github.com:RootSpaceOrg/mkt-platform-api.git') === 'https://github.com/RootSpaceOrg/mkt-platform-api', 'remote ssh');
ok(r.webUrl('https://github.com/org/repo') === 'https://github.com/org/repo' && r.webUrl(null) === null, 'remote https');
let e = r.parseEntry('Merge pull request #42 from org/feature/12-pdf', '\nExportar roadmap em PDF\n');
ok(e.pr === 42 && e.title === 'Exportar roadmap em PDF', 'merge de PR usa o título do PR');
e = r.parseEntry('feat: abrir mais rápido (#57)', '');
ok(e.pr === 57 && e.title === 'feat: abrir mais rápido', 'squash');
e = r.parseEntry('hotfix direto', '');
ok(e.pr === null && e.title === 'hotfix direto', 'commit direto');

ok(r.isBackMerge('Back-merge: prod hotfix main -> develop') && r.isBackMerge("Merge branch 'main' into develop") && r.isBackMerge("Merge remote-tracking branch 'origin/master' into develop"), 'back-merge');
ok(!r.isBackMerge('Merge pull request #3 from org/feature/x') && !r.isBackMerge('feat: mainframe'), 'não é back-merge');

// ---------- quadro (workflow) por projeto ----------
const bd = req(join(dir, 'b.js'));
ok(bd.keyOf('Revisão por agente') === 'revisao-por-agente', 'key da coluna sem acento');
let threw = '';
try { bd.saveBoard('conteudo', [{ label: 'Ideias', kind: 'backlog' }]); } catch (e) { threw = e.message; }
ok(threw.includes('feito'), 'quadro precisa de coluna feito');
const cols = bd.saveBoard('conteudo', [
  { label: 'Ideias', kind: 'backlog', description: 'o que pode virar post' },
  { label: 'Pesquisa', kind: 'todo', agent_id: 7, instruction: 'Pesquise o tema', next_key: 'roteiro' },
  { label: 'Roteiro', kind: 'doing', agent_id: 8, instruction: 'Escreva o roteiro', next_key: 'revisao' },
  { label: 'Revisão', kind: 'review' },
  { label: 'Publicado', kind: 'done' },
]);
ok(cols.map(c => c.key).join() === 'ideias,pesquisa,roteiro,revisao,publicado', 'colunas salvas na ordem');
ok(db.prepare('select stage from tasks where id = 9').get().stage === 'ideias', 'tarefa existente cai na coluna do mesmo tipo');
ok(bd.resolveStage('conteudo', 'Roteiro') === 'roteiro' && bd.stageFor('conteudo', 'review') === 'revisao', 'acha coluna por nome e por tipo');
ok(bd.boardBlock('conteudo').includes('Pesquisa [pesquisa, a fazer]') && bd.boardBlock('kultivai') === '', 'quadro no prompt (só de quem tem)');

// pipeline: tarefa entra em Pesquisa e o agente 7 pega com a etapa no prompt
bd.setStage(9, 'pesquisa');
ok(db.prepare('select "column" c from tasks where id = 9').get().c === 'todo', 'mover para a coluna leva o tipo junto');
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
const st = started.find(s => s.task_id === 9);
ok(st && st.agent_id === 7 && st.stage === 'pesquisa' && st.prompt.startsWith('Etapa do quadro: Pesquisa.') && st.prompt.includes('Roteiro'), 'etapa com agente dispara com a instrução e o destino');
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
ok(!started.some(s => s.task_id === 9), 'já rodando: não dispara de novo');
db.exec("update runs set status = 'succeeded' where task_id = 9; insert into proposals values (1, 9, 'proposed')");
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
ok(!started.some(s => s.task_id === 9), 'decisão esperando você: a etapa espera');
db.exec("update proposals set status = 'approved'");
bd.setStage(9, 'roteiro');
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
ok(started.find(s => s.task_id === 9)?.agent_id === 8, 'próxima etapa: o agente dela pega');
ok(bd.saveBoard('conteudo', []).length === 0 && db.prepare('select stage from tasks where id = 9').get().stage === null, 'quadro vazio volta ao padrão');

rmSync(dir, { recursive: true, force: true });
console.log('dispatch ok');
