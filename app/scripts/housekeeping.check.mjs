// Self-check da limpeza (Utils > Limpeza): o que entra no levantamento e as travas do que pode ser apagado.
// `node scripts/housekeeping.check.mjs`
import { build } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.hk-check-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const fakeDev = join(dir, 'Development');
mkdirSync(fakeDev);
const stub = join(dir, 'db.js');
writeFileSync(stub, `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(\`
  create table runs (id integer primary key, repo_path text, worktree_path text, branch text, status text, task_id integer);
  create table tasks (id integer primary key, "column" text);
  create table deliveries (id integer primary key, run_id integer, title text, status text, video text);
  create table chats (id integer primary key, cwd text, updated_at text);
  create table repos (path text, name text, default_branch text);
\`);
module.exports = { db, DEV_ROOT: ${JSON.stringify(fakeDev)}, all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a) };`);
await build({ entryPoints: [join(root, 'electron/housekeeping.ts')], outfile: join(dir, 'h.js'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
  plugins: [{ name: 'db', setup: b => b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stub, external: true })) }] });
const req = createRequire(import.meta.url);
const h = req(join(dir, 'h.js'));
const { db } = req(stub);
const ok = (c, m) => { if (!c) throw new Error(m); };

// vídeos: o da entrega em revisão fica; o da revisada e o sem entrega entram
const videos = join(dir, 'videos');
mkdirSync(videos);
for (const f of ['aberta.mp4', 'revisada.mp4', 'solta.mp4']) writeFileSync(join(videos, f), 'x');
db.exec(`insert into deliveries (run_id, title, status, video) values (1, 'A', 'pending', 'aberta.mp4'), (2, 'B', 'accepted', 'revisada.mp4')`);
let items = await h.scanHousekeeping(videos);
const vids = items.filter(i => i.kind === 'video').map(i => i.id.split(/[\\/]/).pop()).sort();
ok(vids.join() === 'revisada.mp4,solta.mp4', 'vídeo da entrega em revisão fica de fora');

// .central-tmp na pasta de um agente entra
const tmp = join(fakeDev, '.central-agents', 'pesquisa', '.central-tmp');
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, 'dump.json'), '{}');
items = await h.scanHousekeeping(videos);
ok(items.some(i => i.kind === 'temp' && i.id === tmp), '.central-tmp entra');

// limpar: apaga o marcado e se recusa a sair das pastas permitidas
const outside = join(dir, 'importante.db');
writeFileSync(outside, 'x');
const r = await h.cleanHousekeeping([
  ...items.filter(i => i.kind === 'video' || i.kind === 'temp'),
  { kind: 'video', id: join(videos, '..', 'importante.db'), label: 'fuga de vídeo', why: '', size: null },
  { kind: 'temp', id: dir, label: 'fuga de temp', why: '', size: null },
  { kind: 'worktree', id: join(fakeDev, '.central-worktrees', '..', '..'), label: 'fuga de worktree', why: '', size: null },
  { kind: 'branch', id: 'x', label: 'main', why: '', size: null, repo: dir, branch: 'main' },
], videos);
ok(!existsSync(join(videos, 'revisada.mp4')) && !existsSync(join(videos, 'solta.mp4')) && existsSync(join(videos, 'aberta.mp4')), 'apaga só os vídeos marcados');
ok(!existsSync(tmp), 'apaga a .central-tmp');
ok(existsSync(outside) && existsSync(dir), 'nada fora das pastas permitidas');
ok(r.done === 3 && r.failed.length === 4, `recusa as 4 tentativas de fuga (${JSON.stringify(r)})`);
console.log('housekeeping ok');
