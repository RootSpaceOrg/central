// MCPs do Claude Code: a saída do `claude mcp list` vira lista com status, tipo e o prefixo das ferramentas.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
await build({ entryPoints: [join(root, 'electron/mcp-parse.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'f.js'), logLevel: 'error' });
const f = createRequire(import.meta.url)(join(dir, 'f.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };

const out = `Checking MCP server health…

claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
plugin:cloudflare:cloudflare-docs: https://docs.mcp.cloudflare.com/mcp (HTTP) - ✔ Connected
sentry: https://mcp.sentry.dev/mcp (HTTP) - ! Needs authentication
local: node C:/x/server.js - ✗ Failed to connect`;
const l = f.parseList(out);
ok(l.length === 4, 'quatro servidores, sem a linha de cabeçalho');
ok(l[0].kind === 'connector' && l[0].status === 'connected' && l[0].tools_prefix === 'mcp__claude_ai_Gmail', 'conector do claude.ai');
ok(l[1].kind === 'plugin' && l[1].target === 'https://docs.mcp.cloudflare.com/mcp' && l[1].tools_prefix === 'mcp__plugin_cloudflare_cloudflare-docs', 'plugin, sem o (HTTP)');
ok(l[2].kind === 'own' && l[2].status === 'auth', 'precisa autorizar');
ok(l[3].status === 'failed' && l[3].target === 'node C:/x/server.js', 'stdio que falhou');

rmSync(dir, { recursive: true, force: true });
console.log('mcp-servers ok');
