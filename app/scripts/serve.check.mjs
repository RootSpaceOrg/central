// Self-check do servidor que a Central sobe fora da sessão do agente (serve_for_review): registra e derruba de verdade.
// `node scripts/serve.check.mjs`
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.serve-check-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const stub = join(dir, 'db.js');
writeFileSync(stub, `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('create table run_procs (id integer primary key autoincrement, run_id integer not null, pid integer not null, start text not null, cmd text, server integer not null default 0, kill_after text)');
module.exports = { db, all: (s, ...a) => db.prepare(s).all(...a), get: (s, ...a) => db.prepare(s).get(...a), run: (s, ...a) => db.prepare(s).run(...a) };`);
await build({ entryPoints: [join(root, 'electron/leftovers.ts')], outfile: join(dir, 'l.js'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
  plugins: [{ name: 'db', setup: b => b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stub, external: true })) }] });
const req = createRequire(import.meta.url);
const l = req(join(dir, 'l.js'));
const { db } = req(stub);
const ok = (c, m) => { if (!c) throw new Error(m); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// um "servidor" de mentira, solto da sessão (como o serve_for_review faz)
const child = spawn('node -e "setInterval(() => {}, 1000)"', { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
await l.trackServer(7, child.pid, 'node -e ...', 60_000);
const row = db.prepare('select * from run_procs where pid = ?').get(child.pid);
ok(row && row.server === 1 && row.start, 'registrado com a hora de criação');
ok(alive(child.pid), 'continua no ar depois de registrado');
ok(await l.stopServer(child.pid), 'serve_stop acha o servidor');
await new Promise(r => setTimeout(r, 800));
ok(!alive(child.pid), 'serve_stop derruba de verdade');
ok(!db.prepare('select 1 from run_procs where pid = ?').get(child.pid), 'sai do registro');
ok(!(await l.stopServer(999999)), 'pid que não é da Central: não mexe');
console.log('serve ok');
process.exit(0);
