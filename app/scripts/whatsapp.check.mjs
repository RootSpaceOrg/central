// Texto do WhatsApp: markdown da Central vira o formato do WhatsApp.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'wa-'));
await build({ entryPoints: [join(root, 'electron/wa-format.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'f.js'), logLevel: 'error' });
const f = createRequire(import.meta.url)(join(dir, 'f.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };

ok(f.toWhatsApp('**Feito**: subiu') === '*Feito*: subiu', 'negrito vira um asterisco');
ok(f.toWhatsApp('## Resumo\n- um\n- dois') === '*Resumo*\n• um\n• dois', 'cabeçalho e lista');
ok(f.toWhatsApp('veja [o PR](https://github.com/x/pull/1)') === 'veja o PR (https://github.com/x/pull/1)', 'link mostra a url');
ok(f.toWhatsApp('rode `npm test`') === 'rode npm test', 'código sem crase');
ok(f.digits('+55 (11) 99999-8888') === '5511999998888', 'só dígitos');

rmSync(dir, { recursive: true, force: true });
console.log('whatsapp ok');
