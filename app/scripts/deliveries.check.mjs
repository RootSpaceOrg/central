// Self-check das notas de entrega e do digest: `node scripts/deliveries.check.mjs` (banco em memória)
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.dlv-check-'));
// a tabela de entregas vem do db.ts de verdade (o mesmo SQL que o app cria)
const schema = /create table if not exists deliveries \([\s\S]*?\n  \);/.exec(readFileSync(join(root, 'electron/db.ts'), 'utf8'))[0];
const stub = join(dir, 'db.js');
writeFileSync(stub, `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(\`
  create table agents (id integer primary key, name text); insert into agents values (2, 'Marketing');
  create table projects (slug text primary key, name text, done_when text not null default 'merge'); insert into projects (slug, name) values ('kultivai', 'KultivAi');
  create table runs (id integer primary key, project_slug text, agent_id integer, task_id integer, prompt text, status text, result text,
    pr_url text, worktree_path text, base_branch text, cost_usd real, started_at text, finished_at text, waiting text);
  create table tasks (id integer primary key, title text, project_slug text, "column" text, updated_at text, pr_url text);
  create table milestone_events (id integer primary key, kind text, title text, detail text, author text, at text, project_slug text);
  create table ideas (id integer primary key, created_at text, status text);
  create table proposals (id integer primary key, created_at text, status text);
  create table memories (id integer primary key, created_at text, author text, status text);
  create table run_procs (id integer primary key autoincrement, run_id integer, pid integer, start text, cmd text, server integer default 0, kill_after text);
  \${${JSON.stringify(schema)}}
  insert into tasks values (7, 'Exportar roadmap', 'kultivai', 'review', '2026-11-01T10:00:00Z', null);
  insert into runs values (1, 'kultivai', 2, 7, 'Exportar o roadmap em PDF\\nDetalhes', 'succeeded', 'Feito. PR aberto.', 'https://github.com/x/y/pull/3', null, null, 0.5, '2026-11-02T10:00:00Z', '2026-11-02T11:30:00Z', null);
  insert into runs values (2, 'kultivai', null, null, '[gestor:planejar] Você é o gestor', 'succeeded', 'Backlog organizado.', null, null, null, 0.1, '2026-11-02T12:00:00Z', '2026-11-02T12:30:00Z', null);
  insert into runs values (3, 'kultivai', 2, null, 'Tentar algo', 'killed', null, null, null, null, null, '2026-11-02T12:00:00Z', '2026-11-02T12:01:00Z', null);
  insert into runs values (4, 'kultivai', 2, 8, 'Listar buckets', 'succeeded', 'Parei: sessão AWS expirada.', null, null, null, 0.1, '2026-11-02T13:00:00Z', '2026-11-02T13:05:00Z', '{"reason":"sessão AWS expirada"}');
  insert into tasks values (8, 'Listar buckets', 'kultivai', 'doing', '2026-11-02T13:00:00Z', null);
  insert into milestone_events values (1, 'done', 'App abre rápido', 'Agora → Feito', 'agente', '2026-11-02T13:00:00Z', 'kultivai');
  insert into ideas values (1, '2026-11-02T09:00:00Z', 'new');
  insert into proposals values (1, '2026-11-02T09:00:00Z', 'proposed');
  insert into memories values (1, '2026-11-02T09:00:00Z', 'agente', 'active');
\`);
module.exports = {
  db,
  all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a),
  now: () => '2026-11-02T14:00:00Z',
};`);
await build({
  entryPoints: [join(root, 'electron/deliveries.ts')], outfile: join(dir, 'd.js'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
  plugins: [{ name: 'db', setup: b => b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stub, external: true })) }],
});
const d = createRequire(import.meta.url)(join(dir, 'd.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };

// agente conta a entrega; a última versão vale
d.reportDelivery(1, { title: 'rascunho', what: 'x' });
d.reportDelivery(1, { title: 'Exportação do roadmap em PDF', what: 'Botão Exportar na aba Roadmap', how_to_test: 'Clique em Exportar' });
await d.closeDelivery(1);
let [e] = d.listDeliveries(null, null).filter(x => x.run_id === 1);
ok(e.title === 'Exportação do roadmap em PDF' && e.explained && e.how_to_test === 'Clique em Exportar', 'nota do agente');
ok(e.status === 'review' && e.pr_url.endsWith('/pull/3') && e.agent_name === 'Marketing' && e.project_name === 'KultivAi', 'com PR vai para revisão');

// sem nota: a Central monta do resultado; sem código = informativo
await d.closeDelivery(2);
[e] = d.listDeliveries(null, null).filter(x => x.run_id === 2);
ok(!e.explained && e.title === 'Gestor organizou o backlog' && e.what === 'Backlog organizado.' && e.status === 'info', 'sem nota e sem código');
await d.closeDelivery(3);
ok(!d.listDeliveries(null, null).some(x => x.run_id === 3), 'interrompida não vira entrega');
await d.closeDelivery(1);
ok(d.listDeliveries(null, 'review').length === 1, 'fechar de novo não duplica');

// pedir ajuste tira da fila; quando o ajuste termina, volta para a revisão
const first = d.listDeliveries(null, 'review')[0];
d.reviewDelivery(first.id, 'adjusting', 'Adicione subtrai');
ok(!d.listDeliveries(null, 'review').length && d.listDeliveries(null, 'adjusting')[0].review_note === 'Adicione subtrai', 'em ajuste, com o pedido');
await d.reopenDelivery(1);
ok(d.listDeliveries(null, 'review').length === 1, 'ajuste terminou: de volta à revisão');
await d.reopenDelivery(1);
ok(d.listDeliveries(null, 'review').length === 1, 'reabrir sem estar em ajuste não muda nada');

// agente esperando você: entrega pausada (fora da fila); retomou e terminou: volta para a revisão e a tarefa anda
await d.closeDelivery(4);
ok(d.listDeliveries(null, 'paused').length === 1 && !d.listDeliveries(null, 'review').some(x => x.run_id === 4), 'esperando = pausada');
{ const { db } = (await import('node:module')).createRequire(import.meta.url)(stub); db.exec("update runs set waiting = null, result = 'Feito.', pr_url = 'https://github.com/x/y/pull/9' where id = 4"); }
await d.reopenDelivery(4);
ok(d.listDeliveries(null, 'review').some(x => x.run_id === 4), 'retomada termina na revisão');
{ const { db } = (await import('node:module')).createRequire(import.meta.url)(stub); ok(db.prepare('select "column" c from tasks where id = 8').get().c === 'review', 'tarefa sai de fazendo para revisão'); }

// revisão: aceitar leva a tarefa para Feito
d.reviewDelivery(d.listDeliveries(null, 'review').find(x => x.run_id === 1).id, 'accepted', null);
ok(!d.listDeliveries(null, 'review').some(x => x.run_id === 1), 'saiu da fila');
const g = d.digest('2000-01-01T00:00:00Z');
ok(g.tasks_done.some(t => t.id === 7), 'tarefa aceita conta como concluída');
ok(g.deliveries.length === 3 && g.runs === 3 && g.minutes === 125 && g.cost_usd === 0.7, 'números do digest');
ok(g.roadmap[0].title === 'App abre rápido' && g.ideas === 1 && g.decisions === 1 && g.memories === 1, 'roadmap, ideias, decisões, memórias');
ok(d.digest('2999-01-01T00:00:00Z').deliveries.length === 0, 'desde depois: vazio');

// projeto "pronto = produção": aceitar uma entrega com PR não fecha a tarefa (o sync leva para Em dev/Feito)
{
  const { db } = (await import('node:module')).createRequire(import.meta.url)(stub);
  db.exec("update projects set done_when = 'prod'; update tasks set \"column\" = 'review', pr_url = 'https://github.com/x/y/pull/9' where id = 8");
  d.reviewDelivery(d.listDeliveries(null, 'review').find(x => x.run_id === 4).id, 'accepted', null);
  ok(db.prepare('select "column" c from tasks where id = 8').get().c === 'review', 'produção: aceite não leva a Feito');
}

rmSync(dir, { recursive: true, force: true });
console.log('deliveries ok');
