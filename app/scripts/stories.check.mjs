// Self-check das histórias (parte → merge em develop sozinha → teste de usuário → Revisão): `node scripts/stories.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.story-check-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const stub = join(dir, 'db.js');
writeFileSync(stub, `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(\`
  create table agents (id integer primary key, permission text, name text, builtin integer default 0, priority text default 'normal');
  insert into agents (id, permission, name) values (6, 'full', 'Tech');
  create table projects (slug text primary key, name text, status text, todo_agent_id integer, todo_parallel integer, todo_hours text, folder text, done_when text not null default 'merge', dev_url text, dev_login text);
  insert into projects (slug, name, status, todo_agent_id, todo_parallel, todo_hours) values ('kultivai', 'KultivAi', 'active', 6, 3, '');
  create table repos (path text, name text, project_slug text, remote text);
  create table runs (id integer primary key, project_slug text, agent_id integer, task_id integer, status text, finished_at text, stage text, waiting text,
    board_id integer, prompt text, board_moved integer default 0, result text, pr_url text, worktree_path text, base_branch text);
  create table tasks (id integer primary key, project_slug text, "column" text, title text, body text, repo_path text, priority integer default 2,
    position integer default 0, stage text, pr_url text, proposal_id integer, idea_id integer, milestone_id integer, color text, depends_on text,
    picked_at text, parent_id integer, source text, source_ref text, created_at text default '2026-11-01', updated_at text default '2026-11-01');
  create table deliveries (id integer primary key, run_id integer, project_slug text, agent_id integer, task_id integer, title text, what text, why text,
    how_to_test text, risks text, explained integer, outcome text, pr_url text, files integer, additions integer, deletions integer, diff_stat text,
    status text, review_note text, created_at text, reviewed_at text, closed_by text, closed_how text);
  create table proposals (id integer primary key, task_id integer, status text, project_slug text, title text, body text, next_action text, tier integer, source text, source_ref text,
    updated_at text, created_at text default '2026-11-01', summary text, options text, agent_id integer, closed_by text, closed_how text, closed_reason text, closed_at text);
  create table decisions (proposal_id integer, verdict text, reason text);
  create table proposal_tasks (proposal_id integer, task_id integer);
  create table ideas (id integer primary key, status text, task_id integer);
  create table milestones (id integer primary key);
  create table boards (id integer primary key, name text, project_slug text);
  create table board_cols (board_id integer, key text, label text, position integer, agent_id integer, instruction text, parallel integer, hours text, next_key text);
  create table task_boards (task_id integer, board_id integer, stage text, position integer default 0, updated_at text);
  create table run_procs (id integer primary key, run_id integer, pid integer, start text, cmd text, server integer, kill_after text);
  create table settings (key text primary key, value text);
\`);
let tick = 0;
module.exports = { db, now: () => new Date(Date.UTC(2026, 10, 2, 12, 0, tick++)).toISOString(), all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a) };`);
const opts = { bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', plugins: [{ name: 'db', setup: b => b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stub, external: true })) }] };
for (const [m, out] of [['backlog', 'b'], ['stories', 's'], ['deliveries', 'l'], ['dispatch', 'd'], ['cleanup', 'c']]) await build({ ...opts, entryPoints: [join(root, `electron/${m}.ts`)], outfile: join(dir, `${out}.js`) });
const req = createRequire(import.meta.url);
const [b, s, l, d, cl] = ['b', 's', 'l', 'd', 'c'].map(x => req(join(dir, `${x}.js`)));
const { db } = req(stub);
const ok = (c, m) => { if (!c) throw new Error(m); };
const col = id => db.prepare('select "column" c from tasks where id = ?').get(id).c;
const task = (title, extra = {}) => b.createTask({ project_slug: 'kultivai', repo_path: null, title, body: null, column: 'backlog', priority: 2, ...extra }).id;

// história e partes
const story = task('Professora consegue exportar o boletim');
const a = task('API do boletim', { parent_id: story });
const c = task('Tela do boletim', { parent_id: story });
ok(db.prepare('select count(*) n from tasks where parent_id = ?').get(story).n === 2, 'partes ligadas à história');
let err = ''; try { task('Neta', { parent_id: a }); } catch (e) { err = e.message; }
ok(/já é subtarefa/.test(err), 'um nível só: parte não vira história');
const big = task('História grande');
for (let i = 0; i < b.MAX_SUBTASKS; i++) task(`Parte ${i} da grande`, { parent_id: big });
err = ''; try { task('Uma a mais', { parent_id: big }); } catch (e) { err = e.message; }
ok(/grande demais/.test(err), 'limite de partes por história');
db.exec(`delete from tasks where id = ${big} or parent_id = ${big}`);

// mesmo bug cadastrado de novo com outras palavras
task('Spec agrupar/a3-2ano.spec.ts importa sql/a3.json fora do repo e quebra o Karma');
ok(b.similarTask('kultivai', 'ng test quebra: agrupar/a3-2ano.spec.ts importa sql/a3.json fora do repo'), 'acha a tarefa repetida');
ok(!b.similarTask('kultivai', 'Reembolso de Pix pelo admin'), 'título diferente passa');

// história em A fazer leva as partes; o responsável pega as partes, nunca a história
b.updateTask(story, { column: 'todo' });
ok(col(a) === 'todo' && col(c) === 'todo', 'partes vão junto para A fazer');
let started = [];
const deps = { quota: async () => 10, now: () => new Date(2026, 10, 2, 12), start: i => {
  started.push(i);
  db.prepare("insert into runs (project_slug, agent_id, task_id, status, prompt) values (?,?,?, 'queued', ?)").run(i.project_slug, i.agent_id, i.task_id, i.prompt);
} };
await d.dispatchTodo(deps);
ok(started.some(x => x.task_id === a) && started.some(x => x.task_id === c) && !started.some(x => x.task_id === story), 'despacha as partes, não a história');
b.moveTaskForRun(a, 'doing');
ok(col(story) === 'doing', 'parte começou: história em andamento');

// parte terminou: nota só de registro e merge sozinho
const runA = db.prepare("select id from runs where task_id = ?").get(a).id;
db.exec(`update runs set status = 'succeeded', finished_at = '2026-11-02T11:20:00Z', result = 'ok' where id = ${runA}`);
await l.closeDelivery(runA);
ok(db.prepare('select status from deliveries where run_id = ?').get(runA).status === 'info', 'entrega de parte não vai para a Revisão');
await s.childFinished(runA, a, true, 'https://github.com/x/y/pull/1', async () => null);
ok(col(a) === 'done', 'mergeado em develop: parte feita (pronto = merge)');

// merge que não dá: volta para o agente uma vez; na segunda, fica para o Gustavo
const runC = db.prepare("select id from runs where task_id = ?").get(c).id;
db.exec(`update runs set status = 'succeeded', finished_at = '2026-11-02T11:21:00Z' where id = ${runC}`);
await l.closeDelivery(runC);
await s.childFinished(runC, c, true, 'https://github.com/x/y/pull/2', async () => 'conflito');
ok(col(c) === 'todo' && /Merge automático falhou/.test(db.prepare('select body from tasks where id = ?').get(c).body), 'falhou o merge: agente conserta');
await s.childFinished(runC, c, true, 'https://github.com/x/y/pull/2', async () => 'conflito de novo');
ok(col(c) === 'review' && db.prepare('select status from deliveries where run_id = ?').get(runC).status === 'review', 'segunda falha: vai para o Gustavo');
ok(s.storiesToTest('2026-11-01').length === 0, 'parte aberta: história ainda não testa');
await s.childFinished(runC, c, true, 'https://github.com/x/y/pull/2', async () => null);

// todas em develop: teste de usuário da história
ok(s.storiesToTest('2026-11-01').map(x => x.id).includes(story), 'todas as partes em develop: história pronta para o teste');
started = [];
await d.dispatchTodo(deps);
const qa = started.find(x => x.task_id === story);
ok(qa && qa.prompt.startsWith(s.STORY_HEAD) && qa.prompt.includes('API do boletim') && qa.prompt.includes('roteiro de usuário'), 'teste de usuário com as partes e o roteiro');
const runS = db.prepare("select max(id) id from runs where task_id = ?").get(story).id;

// o teste achou um problema: cria conserto, a história segue em andamento e nada vai para o Gustavo
const fix = task('Conserto: botão exportar some no celular', { parent_id: story, column: 'todo' });
db.exec(`update runs set status = 'succeeded', finished_at = '2026-11-02T11:40:00Z' where id = ${runS}`);
await l.closeDelivery(runS);
ok(db.prepare('select status from deliveries where run_id = ?').get(runS).status === 'info', 'teste com conserto pendente: não vai para a Revisão');

// conserto feito: testa de novo e, funcionando, uma entrega só para o Gustavo
await s.childFinished(0, fix, true, null);
ok(col(fix) === 'done', 'parte sem PR: feita direto');
started = [];
await d.dispatchTodo(deps);
const run2 = db.prepare("select max(id) id from runs where task_id = ?").get(story).id;
ok(started.some(x => x.task_id === story) && run2 !== runS, 'testa de novo depois do conserto');
db.exec(`update runs set status = 'succeeded', finished_at = '2026-11-02T11:50:00Z' where id = ${run2}`);
await l.closeDelivery(run2);
ok(db.prepare('select status from deliveries where run_id = ?').get(run2).status === 'review', 'história testada: uma entrega na Revisão, mesmo sem código');
// tarefa feita (merge, ou movida à mão): a entrega dela sai da fila de revisão
const solo = task('Tarefa solta com PR');
db.exec(`insert into deliveries (run_id, task_id, status) values (900, ${solo}, 'review')`);
b.updateTask(solo, { column: 'done' });
ok(db.prepare('select status from deliveries where run_id = 900').get().status === 'accepted', 'feita: entrega sai da Revisão');
// faxina do dono: fecha com motivo, decide o não crítico pelo mesmo caminho, nunca fecha história, reabrir devolve
db.exec("insert into agents (id, permission, name) values (40, 'edits', 'Dono · KultivAi')");
db.exec("insert into proposals (id, status, project_slug, title) values (501, 'proposed', 'kultivai', 'Precisa de você (velha)'), (502, 'proposed', 'kultivai', 'Qual biblioteca de gráfico?'), (503, 'proposed', 'kultivai', 'Subir para prod?')");
ok(/fechada/.test(cl.closeDecision(501, 'resolvida', 'O PR #12 entrou ontem', 40)), 'fecha decisão resolvida');
ok(db.prepare('select status, closed_by from proposals where id = 501').get().closed_by === 'Dono · KultivAi', 'quem fechou fica registrado');
let e2 = ''; try { cl.closeDecision(503, 'resolvida', '', 40); } catch (e) { e2 = e.message; } ok(/motivo/.test(e2), 'fechar exige motivo');
const solo2 = task('Tarefa da escolha');
db.exec(`update proposals set task_id = ${solo2} where id = 502`);
cl.ownerDecide(502, 'Chart.js', 'já usamos no admin', 40);
ok(db.prepare('select status from proposals where id = 502').get().status === 'approved' && /Chart\.js/.test(db.prepare('select body from tasks where id = ?').get(solo2).body), 'decisão do dono segue para a tarefa');
cl.refreshDecision(503, 'Ainda vale: o hotfix depende disso', null);
ok(db.prepare('select summary, status from proposals where id = 503').get().status === 'proposed', 'crítica só atualiza o resumo');
// revisão: história não; tarefa solta sim
db.exec(`insert into deliveries (id, run_id, project_slug, task_id, title, what, status) values (801, 901, 'kultivai', ${story}, 'história', 'x', 'review'), (802, 902, 'kultivai', ${solo2}, 'solta', 'x', 'review')`);
ok(/Gustavo/.test(await cl.closeReview(801, 'resolvida', 'já foi', 40)) && db.prepare('select status from deliveries where id = 801').get().status === 'review', 'história nunca é fechada pelo dono');
await cl.closeReview(802, 'superada', 'a entrega #803 cobre', 40);
ok(db.prepare('select status from deliveries where id = 802').get().status === 'accepted', 'revisão superada sai da fila');
ok(cl.closedBy('kultivai', 1e6).decisions.length === 2 && cl.closedBy('kultivai', 1e6).reviews.length === 1, 'painel lista o que foi limpo');
cl.reopenDecision(501); cl.reopenReview(802);
ok(db.prepare('select status from proposals where id = 501').get().status === 'proposed' && db.prepare('select status from deliveries where id = 802').get().status === 'review', 'reabrir devolve para o Gustavo');
console.log('stories ok');
