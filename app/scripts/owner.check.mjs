// Self-check do dono do projeto (eventos, travas, curadoria, insights, registro do operador): `node scripts/owner.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.own-check-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const stub = join(dir, 'db.js');
writeFileSync(stub, `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(\`
  create table agents (id integer primary key, name text, priority text default 'normal', project_slug text, description text);
  insert into agents (id, name, project_slug) values (6, 'Tech Lead', 'kultivai'), (7, 'Montador', 'kultivai');
  create table projects (slug text primary key, name text, color text default '#fff', status text default 'active', todo_agent_id integer, owner_on integer default 0, position integer default 0, one_on_one text, one_on_one_at text, owner_agent_id integer);
  create table routines (id integer primary key, name text, project_slug text, enabled integer default 1);
  insert into projects (slug, name, todo_agent_id) values ('kultivai', 'KultivAi', 6), ('solto', 'Solto', null);
  create table runs (id integer primary key, project_slug text, prompt text, status text, result text, created_at text default (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
  create table directions (id integer primary key, project_slug text, text text);
  insert into directions (project_slug, text) values ('kultivai', '**Objetivo:** renda.\n\n**Foco agora:**\n1. **Post variado todo dia.**\n   - detalhe');
  create table tasks (id integer primary key, project_slug text, "column" text, title text, body text, parent_id integer, priority integer default 2, position integer default 0,
    repo_path text, proposal_id integer, pr_url text, source text, source_ref text, idea_id integer, milestone_id integer, color text, depends_on text, picked_at text,
    created_at text default '2026-11-01', updated_at text default '2026-11-01');
  create table proposals (id integer primary key, project_slug text, status text, task_id integer, title text, created_at text default '2026-11-01', closed_by text, closed_at text);
  create table proposal_tasks (proposal_id integer, task_id integer);
  create table facts (id integer primary key, project_slug text);
  create table memories (id integer primary key, agent_id integer, status text default 'active');
  create table settings (key text primary key, value text);
  create table ideas (id integer primary key autoincrement, project_slug text, title text, body text, status text default 'new', source text, source_ref text, author text,
    task_id integer, created_at text default '2026-11-01', approved_at text, milestone_id integer, triaged_at text, triage text, seen_at text);
  create table deliveries (id integer primary key, task_id integer, project_slug text, title text, run_id integer, status text, created_at text default '2026-11-01', closed_by text, reviewed_at text);
  create table metrics (id integer primary key autoincrement, project_slug text, name text, value real, unit text, note text, at text default (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
  create table events (id integer primary key autoincrement, project_slug text not null, kind text not null, ref text not null, summary text not null,
    urgent integer not null default 0, from_owner integer not null default 0, created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')), handled_at text, pass_run_id integer);
  create unique index events_open on events (project_slug, kind, ref) where handled_at is null;
  create table metric_defs (id integer primary key autoincrement, project_slug text, name text, unit text, how text, every_hours integer default 24, target real, active integer default 1, unique (project_slug, name));
  create table alerts (id integer primary key autoincrement, project_slug text, ref text, summary text, created_at text default (strftime('%Y-%m-%dT%H:%M:%SZ','now')), resolved_at text);
  create table operator_actions (id integer primary key autoincrement, at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')), action text, target text, project_slug text, context text, reason text);
  insert into tasks (id, project_slug, "column", title) values (1, 'kultivai', 'todo', 'Algo em andamento');
\`);
module.exports = { db, now: () => new Date().toISOString(), all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a) };`);
const opts = { bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', plugins: [{ name: 'db', setup: b => b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stub, external: true })) }] };
for (const [m, out] of [['owner', 'o'], ['operator', 'p'], ['insights', 'i'], ['pulse', 'u'], ['metrics', 'm']]) await build({ ...opts, entryPoints: [join(root, `electron/${m}.ts`)], outfile: join(dir, `${out}.js`) });
const req = createRequire(import.meta.url);
const [o, p, ins, u, mt] = ['o', 'p', 'i', 'u', 'm'].map(x => req(join(dir, `${x}.js`)));
const { db } = req(stub);
const ok = (c, m) => { if (!c) throw new Error(m); };
const open = () => db.prepare('select count(*) n from events where handled_at is null').get().n;
const settings = new Map();
let started = [];
let clock = new Date();
const deps = () => ({
  quota: async () => 10, setting: k => settings.get(k) ?? null, setSetting: (k, v) => settings.set(k, v), now: () => clock,
  start: i => { started.push(i); return Number(db.prepare("insert into runs (project_slug, prompt, status) values (?, ?, 'running')").run(i.project_slug, i.prompt).lastInsertRowid); },
});
const later = min => { clock = new Date(clock.getTime() + min * 60_000); };
// os eventos nascem com o horário real; o relógio do despacho anda a partir dele
const age = min => db.exec(`update events set created_at = '${new Date(Date.now() - min * 60_000).toISOString().slice(0, 19)}Z' where handled_at is null`);

// evento repetido conta uma vez; projeto que não existe é ignorado
o.emitEvent('kultivai', 'insight', 'x1', 'Cliente pediu exportar PDF');
o.emitEvent('kultivai', 'insight', 'x1', 'Cliente pediu exportar PDF');
o.emitEvent('nao-existe', 'insight', 'x2', 'nada');
ok(open() === 1, 'dedupe por tipo + referência');

// desligado: não acorda; ligar ignora o que já estava pendente
ok(await o.dispatchOwners(deps()) === 0, 'dono desligado não acorda');
o.setOwnerOn('kultivai', true);
ok(open() === 1 && db.prepare("select kind from events where handled_at is null").get().kind === 'dono_ligado', 'ligar ignora o passado e pede a primeira passada');
await o.dispatchOwners(deps());
ok(started.length === 1 && started[0].prompt.includes('Primeira passada'), 'primeira passada acorda na hora');
db.exec("update runs set status = 'succeeded'");
started = [];

// debounce: evento novo espera juntar; urgente acorda na hora
o.emitEvent('kultivai', 'ideia_aprovada', 'ideia:9', '#9 Exportar boletim');
await o.dispatchOwners(deps());
ok(started.length === 0, 'espera juntar (debounce)');
age(11);
await o.dispatchOwners(deps());
ok(started.length === 1 && started[0].prompt.startsWith(o.OWNER_HEAD) && started[0].prompt.includes('Exportar boletim'), 'acorda com o lote depois do debounce');
ok(open() === 0 && db.prepare('select pass_run_id from events where ref = ?').get('ideia:9').pass_run_id, 'eventos marcados com a passada');

// uma passada por vez
o.emitEvent('kultivai', 'alerta', 'prod-500', 'Erro 500 em prod no login');
await o.dispatchOwners(deps());
ok(started.length === 1, 'passada rodando: não acorda outra');
db.exec("update runs set status = 'succeeded'");
await o.dispatchOwners(deps());
ok(started.length === 2 && started[1].prompt.includes('Erro 500'), 'urgente acorda sem esperar o debounce');
db.exec("update runs set status = 'succeeded'");

// o que a passada do próprio dono emite não acorda ele de novo
const ownerRun = db.prepare("select max(id) id from runs").get().id;
o.emitEvent('kultivai', 'alerta', 'eco', 'eco do próprio dono', ownerRun);
await o.dispatchOwners(deps());
ok(started.length === 2 && open() === 0, 'evento da passada do dono só fica registrado');

// limite de passadas por dia
for (let i = 0; i < 10; i++) db.exec(`insert into runs (project_slug, prompt, status) values ('kultivai', '${o.OWNER_HEAD} x', 'succeeded')`);
o.emitEvent('kultivai', 'alerta', 'mais', 'mais um alerta');
await o.dispatchOwners(deps());
ok(started.length === 2, 'limite de passadas por dia');
db.exec(`delete from runs where prompt = '${o.OWNER_HEAD} x'`);
db.exec("update events set handled_at = 'x'");

// fila vazia: avisa uma vez
db.exec("update tasks set \"column\" = 'done'");
await o.dispatchOwners(deps());
await o.dispatchOwners(deps());
ok(db.prepare("select count(*) n from events where kind = 'fila_vazia'").get().n === 1, 'fila vazia avisa uma vez');
db.exec("update events set handled_at = 'x'; update runs set status = 'succeeded'");

// curadoria quando a memória cresce
settings.set('owner:curated:kultivai', '0');
for (let i = 0; i < 30; i++) db.exec("insert into facts (project_slug) values ('kultivai')");
await o.dispatchOwners(deps());
ok(db.prepare("select count(*) n from events where kind = 'memoria_cresceu'").get().n === 1, 'memória cresceu: curadoria');
ok(started.at(-1).prompt.includes('move_memory_to_project') || db.prepare("select count(*) n from events where kind = 'memoria_cresceu' and handled_at is null").get().n === 1, 'curadoria no prompt (ou esperando o debounce)');
db.exec("update events set handled_at = 'x'; update runs set status = 'succeeded'");

// registro do operador: história devolvida é urgente para o dono; ideia aprovada vira evento
db.exec("insert into tasks (id, project_slug, \"column\", title) values (50, 'kultivai', 'review', 'Professora exporta o boletim'), (51, 'kultivai', 'done', 'Parte'); update tasks set parent_id = 50 where id = 51");
db.exec("insert into deliveries (id, task_id, project_slug, title, run_id) values (70, 50, 'kultivai', 'teste', 99)");
p.onReviewed(70, 'adjusting', 'O PDF sai em branco no celular');
const dev = db.prepare("select * from events where kind = 'historia_devolvida'").get();
ok(dev && dev.urgent === 1 && dev.summary.includes('PDF sai em branco'), 'história devolvida vira evento urgente com a nota');
ok(db.prepare("select reason from operator_actions where action = 'história: adjusting'").get().reason === 'O PDF sai em branco no celular', 'ação do operador com o motivo');
p.onReviewed(70, 'accepted', null);
ok(db.prepare("select count(*) n from events where kind = 'historia_validada'").get().n === 1, 'história validada vira evento');
db.exec("insert into ideas (id, project_slug, title) values (5, 'kultivai', 'Agenda no app')");
p.onIdea(5, 'approved');
ok(db.prepare("select count(*) n from events where kind = 'ideia_aprovada' and ref = 'ideia:5'").get().n === 1, 'ideia aprovada vira evento');
ok(u.pulse().validated === 1 && u.pulse().returned === 1, 'semana conta validadas e devolvidas');

// insight: com dono ligado vai para ele; sem dono, vira ideia na Triagem
ok(/dono/.test(ins.addInsight('kultivai', 'Cliente X reclamou do PDF', null, 'agente')), 'insight vai para o dono');
ok(/ideia/.test(ins.addInsight('solto', 'Pedido sem dono', null, 'agente')) && db.prepare("select count(*) n from ideas where project_slug = 'solto'").get().n === 1, 'sem dono: vira ideia');

// métrica do produto com direção
u.reportMetric('kultivai', 'Posts publicados', 10, 'posts', null);
u.reportMetric('kultivai', 'Posts publicados', 14, 'posts', 'semana boa');
const m = u.pulse().projects.find(x => x.slug === 'kultivai').metrics[0];
ok(m.value === 14 && m.prev === 10, 'métrica guarda a leitura anterior');
ok(u.pulse().projects.find(x => x.slug === 'kultivai').focus === 'Post variado todo dia.', 'foco do rumo numa linha');
// número combinado (sem deploy): vencido, vira evento para o dono medir; medido, só de novo no próximo intervalo
ok(/Combinei/.test(mt.defineMetric('kultivai', { name: 'Assinantes', unit: null, how: 'painel Stone > assinaturas ativas', every_hours: 24, target: 300 })), 'combina número');
ok(/Atualizei/.test(mt.defineMetric('kultivai', { name: 'Assinantes', how: 'painel Stone', every_hours: 12, target: 300 })), 'mesmo nome atualiza');
ok(mt.dueMetrics('kultivai').some(d => d.name === 'Assinantes'), 'nunca medido: vencido');
db.exec("update events set handled_at = 'x'; update runs set status = 'succeeded'");
await o.dispatchOwners(deps());
ok(db.prepare("select count(*) n from events where kind = 'medir'").get().n === 1, 'vencido: evento para medir');
u.reportMetric('kultivai', 'Assinantes', 120, null, null);
ok(!mt.dueMetrics('kultivai').some(d => d.name === 'Assinantes'), 'medido agora: não vence');
let err = ''; try { mt.defineMetric('kultivai', { name: 'X', how: '' }); } catch (e) { err = e.message; } ok(/como medir/.test(err), 'precisa dizer de onde vem');

// quebrou de verdade: avisa uma vez por referência (Windows/WhatsApp), fica até resolver
const sent = [];
o.onCriticalAlert((t, b) => sent.push(t));
o.criticalAlert('kultivai', 'Cobrança falhando para todos', 'stone-500');
o.criticalAlert('kultivai', 'Cobrança falhando para todos', 'stone-500');
ok(sent.length === 1 && db.prepare("select count(*) n from alerts where resolved_at is null").get().n === 1, 'alerta crítico uma vez');
o.resolveAlert(db.prepare('select id from alerts').get().id);
ok(db.prepare("select count(*) n from alerts where resolved_at is null").get().n === 0, 'resolvido sai do cockpit');

// pedido de 1:1 fica no produto
mt.requestOneOnOne('kultivai', 'Repensar o time da Linha');
ok(db.prepare("select one_on_one from projects where slug = 'kultivai'").get().one_on_one === 'Repensar o time da Linha', 'pedido de 1:1');
// papéis: com dono de negócio, é ele quem acorda; sem tech lead, nada trava (o prompt só avisa)
db.exec("insert into agents (id, name, project_slug) values (9, 'Dono · KultivAi', 'kultivai'); update projects set owner_agent_id = 9 where slug = 'kultivai'");
db.exec("update events set handled_at = 'x'; update runs set status = 'succeeded'");
started = [];
o.emitEvent('kultivai', 'alerta', 'papel', 'teste de papel');
await o.dispatchOwners(deps());
ok(started.length === 1 && started[0].agent_id === 9, 'o dono de negócio acorda (não o tech lead)');
ok(/Tech lead[^\n]*Tech Lead/.test(started[0].prompt), 'o dono sabe quem é o tech lead');
db.exec("update runs set status = 'succeeded'; update projects set todo_agent_id = null where slug = 'kultivai'");
started = [];
o.emitEvent('kultivai', 'alerta', 'papel2', 'sem tech lead');
await o.dispatchOwners(deps());
ok(started.length === 1 && /NINGUÉM/.test(started[0].prompt) && /sem insistir/.test(started[0].prompt), 'sem tech lead: segue, só avisa');
// fila parada (decisão aberta há mais de um dia): vira evento de faxina, no máximo um por dia
db.exec("update events set handled_at = 'x'; update runs set status = 'succeeded'; insert into proposals (project_slug, status, title) values ('kultivai', 'proposed', 'velha')");
await o.dispatchOwners(deps());
await o.dispatchOwners(deps());
ok(db.prepare("select count(*) n from events where kind = 'fila_parada'").get().n === 1, 'fila parada: um evento de faxina');
console.log('owner ok');
