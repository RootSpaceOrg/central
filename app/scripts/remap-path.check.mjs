// Importar dados de outro computador: caminhos que não existem aqui vão para a pasta de projetos daqui.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'remap-'));
await build({ entryPoints: [join(root, 'electron/remap-path.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'f.js'), logLevel: 'error' });
const f = createRequire(import.meta.url)(join(dir, 'f.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };
const dev = join('X:', 'home', 'dev');
const none = () => false;

ok(f.remapPath('C:/Users/Gustavo/Development/mktPlatform/api', dev, none) === join(dev, 'mktPlatform', 'api'), 'Windows (barra normal) → pasta daqui');
ok(f.remapPath(String.raw`C:\Users\Gustavo\Development\.central-worktrees\x\run-3`, dev, none) === join(dev, '.central-worktrees', 'x', 'run-3'), 'Windows (contrabarra) e worktree');
ok(f.remapPath('/Users/g/Development/Central', dev, none) === join(dev, 'Central'), 'Mac → pasta daqui');
ok(f.remapPath('C:/Users/G/Development/Central', dev, p => p.includes('Central')) === 'C:/Users/G/Development/Central', 'existe aqui: não mexe');
ok(f.remapPath('D:/Outros/Projeto', dev, none) === 'D:/Outros/Projeto', 'fora de Development: não mexe');
ok(f.remapPath(null, dev, none) === null, 'vazio');

rmSync(dir, { recursive: true, force: true });
console.log('remap-path ok');
