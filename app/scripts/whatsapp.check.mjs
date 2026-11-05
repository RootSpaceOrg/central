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

// resposta em mensagens curtas
ok(JSON.stringify(f.splitReply('Oi!\n\nTudo ótimo por aqui.\n\nO que você precisa?')) === JSON.stringify(['Oi!', 'Tudo ótimo por aqui.', 'O que você precisa?']), 'cada parágrafo do agente é uma mensagem');
ok(f.splitReply('Uma frase só, sem parágrafos.').length === 1, 'sem parágrafo: uma mensagem');
ok(f.splitReply('Opções:\n• uma\n• duas').length === 1, 'lista fica inteira');
ok(f.splitReply(Array.from({ length: 12 }, (_, i) => `parágrafo ${i}`).join('\n\n')).length === 8, 'teto de 8 mensagens');

rmSync(dir, { recursive: true, force: true });
console.log('whatsapp ok');
