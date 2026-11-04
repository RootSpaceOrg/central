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
  create table proposals (id integer primary key, task_id integer, status text);
  create table boards (id integer primary key autoincrement, name text not null, description text, project_slug text, color text not null default '#7FA2FF', position integer not null default 0, created_at text default '2026-11-01');
  create table board_cols (board_id integer, key text, label text, description text, kind text, position integer, agent_id integer, instruction text, parallel integer, hours text, next_key text, color text, primary key (board_id, key));
  create table task_boards (task_id integer, board_id integer, stage text, position integer default 0, updated_at text, primary key (task_id, board_id));
  create table deliveries (pr_url text, title text, task_id integer);
  insert into agents (id, permission, name, builtin) values (1, 'edits', 'Central', 1);
  create table ideas (id integer primary key, title text, body text, project_slug text, status text, author text, triaged_at text);
  insert into ideas (id, title, body, project_slug, status, author) values (1, 'Solta', 'texto', null, 'new', 'gustavo'),
    (2, 'Com projeto', null, 'kultivai', 'new', 'gustavo'), (3, 'De agente', null, null, 'new', 'agente'), (4, 'Velha', null, null, 'approved', 'gustavo');
  alter table runs add column prompt text;
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

// ---------- quadros (workflows): independentes de projeto, tarefa em vários ----------
const bd = req(join(dir, 'b.js'));
ok(bd.keyOf('Revisão por agente') === 'revisao-por-agente', 'key da coluna sem acento');
const solto = bd.createBoard({ name: 'Pipeline de conteúdo' });
ok(solto.columns.map(c => c.key).join() === 'a-fazer,fazendo,pronto' && solto.project_slug === null, 'quadro solto nasce com colunas padrão');
const cols = bd.saveColumns(solto.id, [
  { label: 'Ideias' },
  { label: 'Pesquisa', agent_id: 7, instruction: 'Pesquise o tema', kind: 'doing', parallel: 2 },
  { label: 'Roteiro', agent_id: 8, instruction: 'Escreva o roteiro' },
  { label: 'Revisão', kind: 'review' },
  { label: 'Publicado', kind: 'done' },
]);
ok(cols.map(c => c.key).join() === 'ideias,pesquisa,roteiro,revisao,publicado', 'colunas salvas na ordem');
ok(bd.resolveBoard('pipeline de conteúdo') === solto.id && bd.resolveStage(solto.id, 'Roteiro') === 'roteiro', 'acha quadro e coluna pelo nome');
ok(bd.nextStage(solto.id, 'pesquisa') === 'roteiro' && bd.nextStage(solto.id, 'publicado') === null, 'depois = a próxima coluna (a última não tem)');

// a tarefa do projeto entra no quadro: a coluna com "kind" reflete no backlog principal
bd.setStage(9, solto.id, 'pesquisa');
ok(db.prepare('select "column" c from tasks where id = 9').get().c === 'doing', 'Pesquisa reflete "fazendo" no principal');
// pedido solto (sem projeto) no mesmo quadro
bd.setStage(10, solto.id, 'pesquisa');
// a mesma tarefa em outro quadro, ao mesmo tempo
const outro = bd.createBoard({ name: 'Revisões', project_slug: 'conteudo' });
bd.setStage(9, outro.id, 'a-fazer');
ok(bd.stagesOf().filter(x => x.task_id === 9).length === 2, 'uma tarefa em dois quadros');
ok(bd.boardsOfProject('conteudo').sort().join() === [solto.id, outro.id].sort().join(), 'quadros do projeto: o dele e onde há tarefas dele');
ok(bd.boardBlock([solto.id]).includes('Pesquisa [pesquisa]') && bd.boardBlock([solto.id]).includes('fazendo'), 'quadro no prompt');

// pipeline: o agente da coluna pega, inclusive o pedido sem projeto
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
const s9 = started.find(x => x.task_id === 9), s10 = started.find(x => x.task_id === 10);
ok(s9 && s9.agent_id === 7 && s9.board_id === solto.id && s9.stage === 'pesquisa' && s9.prompt.startsWith('Etapa "Pesquisa" do quadro Pipeline de conteúdo.') && s9.prompt.includes('"Roteiro"'), 'etapa com agente dispara com a instrução e o destino');
ok(s10 && s10.project_slug === null && s10.agent_id === 7, 'pedido sem projeto também (o agente atua na pasta dele)');
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
ok(!started.some(x => x.task_id === 9), 'já rodando: não dispara de novo');
db.exec("update runs set status = 'succeeded' where task_id in (9, 10); insert into proposals values (1, 9, 'proposed')");
bd.setStage(9, solto.id, 'roteiro');
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
ok(!started.some(x => x.task_id === 9), 'decisão esperando você: a etapa espera');
db.exec("update proposals set status = 'approved'");
started = [];
await d.dispatchTodo({ ...deps(10), now: () => new Date('2026-11-04T13:00:00Z') });
ok(started.find(x => x.task_id === 9)?.agent_id === 8, 'próxima etapa: o agente dela pega');

// remover uma coluna com tarefa: ela vai para a primeira; apagar o quadro não apaga a tarefa
bd.saveColumns(solto.id, [{ key: 'ideias', label: 'Ideias' }, { key: 'publicado', label: 'Publicado', kind: 'done' }]);
ok(bd.stagesOf().find(x => x.task_id === 10 && x.board_id === solto.id).stage === 'ideias', 'coluna removida: tarefa vai para a primeira');
bd.deleteBoard(solto.id);
ok(!bd.stagesOf().some(x => x.board_id === solto.id) && db.prepare('select count(*) n from tasks where id = 10').get().n === 1, 'apagar quadro mantém a tarefa');

// prioridade: com a sessão em 85% só o agente de prioridade alta pega
db.exec("insert into agents (id, permission, name, priority) values (20, 'edits', 'Suporte', 'high'), (21, 'edits', 'Dev', 'normal')");
db.exec("insert into projects values ('pri-a', 'active', 20, 1, ''), ('pri-b', 'active', 21, 1, '')");
db.exec("insert into tasks values (30, 'pri-a', 'todo', 'Bug urgente', null, null, 0, 0, null, null, null), (31, 'pri-b', 'todo', 'Feature', null, null, 0, 0, null, null, null)");
started = [];
await d.dispatchTodo({ ...deps(85), now: () => new Date('2026-11-04T13:00:00Z') });
ok(started.some(x => x.task_id === 30) && !started.some(x => x.task_id === 31), 'em 85% só prioridade alta despacha');

// agente de triagem
const tStarted = [];
const tdeps = (mode, quota = 10) => ({ quota: async () => quota, setting: k => (k === 'triage:mode' ? mode : null),
  start: i => { tStarted.push(i); db.prepare("insert into runs (agent_id, status, prompt) values (?, 'queued', ?)").run(i.agent_id, i.prompt); } });
ok(await d.dispatchTriage(tdeps('off')) === 0, 'triagem desligada não roda');
ok(await d.dispatchTriage(tdeps('no_project', 90)) === 0 && !db.prepare('select triaged_at t from ideas where id = 1').get().t, 'cota alta: triagem espera sem marcar');
ok(await d.dispatchTriage(tdeps('no_project')) === 1 && tStarted[0].agent_id === 1 && tStarted[0].prompt.includes('#1') && !tStarted[0].prompt.includes('Com projeto'), 'sem projeto: só a solta, com a Central');
ok(await d.dispatchTriage(tdeps('all')) === 0, 'uma triagem por vez');
db.exec("update runs set status = 'succeeded' where prompt like 'Triagem%'");
ok(await d.dispatchTriage(tdeps('all')) === 1 && tStarted[1].prompt.includes('Com projeto'), 'todas: pega a com projeto; ideia de agente e já vista ficam de fora');
db.exec("update runs set status = 'succeeded' where prompt like 'Triagem%'");
ok(await d.dispatchTriage(tdeps('all')) === 0, 'nada novo: não roda');

rmSync(dir, { recursive: true, force: true });
console.log('dispatch ok');
