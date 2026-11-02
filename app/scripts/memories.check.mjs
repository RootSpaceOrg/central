// Self-check da memória dos agentes: `node scripts/memories.check.mjs` (banco em memória no lugar do central.db)
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.mem-check-'));
const stub = join(dir, 'db.js');
writeFileSync(stub, `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("create table agents (id integer primary key, name text); insert into agents values (1,'Central'),(2,'Marketing');");
db.exec(\`create table memories (id integer primary key autoincrement, agent_id integer, kind text not null, text text not null,
  author text not null default 'gustavo', source text, pinned integer not null default 0, status text not null default 'active',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')), retired_at text, retired_reason text);
  create table chats (id integer primary key, agent_id integer); insert into chats values (7, 2);
  create table runs (id integer primary key, agent_id integer); insert into runs values (9, null);\`);
module.exports = {
  all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a),
  now: () => new Date().toISOString(),
};`);
await build({
  entryPoints: [join(root, 'electron/memories.ts')], outfile: join(dir, 'm.js'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
  plugins: [{ name: 'db', setup: b => b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stub })) }],
});
const m = createRequire(import.meta.url)(join(dir, 'm.js'));

const ok = (c, msg) => { if (!c) throw new Error(msg); };
process.removeAllListeners('warning');

ok(m.memoryBlock(2).includes('Ainda vazia'), 'vazia avisa como guardar');
const shared = m.createMemory({ agent_id: null, kind: 'preferencia', text: 'Gustavo prefere respostas curtas, em português.' });
const mine = m.createMemory({ agent_id: 2, kind: 'pessoa', text: 'Ana é a cliente piloto do KultivAi.', author: 'agente' });
m.createMemory({ agent_id: 1, kind: 'fato', text: 'Só da Central.' });
ok(m.createMemory({ agent_id: null, kind: 'preferencia', text: 'gustavo prefere respostas curtas, em português.' }).id === shared.id, 'repetida não duplica');

const block = m.memoryBlock(2);
ok(block.includes('respostas curtas') && block.includes('Ana é a cliente'), 'prompt traz a de todos e a sua');
ok(!block.includes('Só da Central'), 'não traz a de outro agente');
ok(m.recallMemories(2, 'cliente piloto').includes('Ana'), 'recall acha pela busca');
ok(m.recallMemories(2, 'cliente piloto').indexOf('Gustavo prefere') === -1, 'recall não traz o que não combina');

m.forgetMemory(mine.id, 'Ana saiu', 'agente');
ok(!m.memoryBlock(2).includes('Ana'), 'esquecida sai do prompt');
ok(m.listMemories(2, true).find(x => x.id === mine.id).retired_reason.includes('Ana saiu'), 'esquecida guarda o motivo');

ok(m.callerAgent({ kind: 'chat', id: 7 }) === 2 && m.callerAgent({ kind: 'run', id: 9 }) === null && m.callerAgent(null) === null, 'quem chama');
let threw = false;
try { m.createMemory({ agent_id: 99, kind: 'fato', text: 'x' }); } catch { threw = true; }
ok(threw, 'agente inexistente falha');

rmSync(dir, { recursive: true, force: true });
console.log('memories ok');
