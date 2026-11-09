// Processos deixados pelas execuções: testes caem quando a execução termina; servidores ficam até a revisão.
// Cria uma árvore de verdade (pai + "ng test" + "ng serve"), mata só o pai (órfãos, como acontece com os agentes) e confere.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') { console.log('ok (só Windows)'); process.exit(0); }
const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'leftovers-'));
// banco em memória no lugar do da Central
writeFileSync(join(dir, 'db-stub.cjs'), `const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(':memory:');
d.exec("create table run_procs (id integer primary key autoincrement, run_id integer, pid integer, start text, cmd text, server integer default 0, kill_after text)");
module.exports = { all: (q, ...a) => d.prepare(q).all(...a), get: (q, ...a) => d.prepare(q).get(...a), run: (q, ...a) => d.prepare(q).run(...a) };`);
await build({
  entryPoints: [join(root, 'electron/leftovers.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'l.js'), logLevel: 'error',
  plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: join(dir, 'db-stub.cjs') })); } }],
});
const L = createRequire(import.meta.url)(join(dir, 'l.js'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

// pai que abre um "ng test" e um "ng serve" (node parado) e fica vivo
const kid = name => `require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '${name}'], { stdio: 'ignore', detached: true })`;
const parent = spawn(process.execPath, ['-e', `const a=${kid('ng test --watch=false')};const b=${kid('ng serve --port 4999')};console.log(a.pid+','+b.pid);setInterval(()=>{},1000)`], { stdio: ['ignore', 'pipe', 'ignore'] });
const [testPid, servePid] = await new Promise(r => parent.stdout.once('data', d => r(String(d).trim().split(',').map(Number))));
L.watchRun(1, parent.pid);
await wait(800);
process.kill(parent.pid); // só o pai: os dois ficam órfãos
await wait(800);
await L.runEnded(1, parent.pid);
await wait(1500);
const fail = (m) => { try { process.kill(testPid); process.kill(servePid); } catch {} throw new Error(m); };
if (alive(testPid)) fail('o teste deveria ter caído no fim da execução');
if (!alive(servePid)) fail('o servidor deveria ficar até a revisão');
L.deliveryReviewed(1);
await wait(2500);
if (alive(servePid)) fail('o servidor deveria cair quando a entrega é revisada');
console.log('ok');
process.exit(0);
