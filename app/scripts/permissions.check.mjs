// Pedidos negados numa conversa viram liberações de um clique (pasta → --add-dir, comando → --allowedTools).
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'perm-'));
await build({ entryPoints: [join(root, 'electron/permissions.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'f.js'), logLevel: 'error' });
const f = createRequire(import.meta.url)(join(dir, 'f.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };

const g = f.grantsFrom([
  { tool_name: 'Write', tool_input: { file_path: 'C:/Users/G/mkt-platform-mcp/server.js' } },
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/G/mkt-platform-mcp/package.json' } },
  { tool_name: 'Glob', tool_input: { path: 'C:/Users/G/.claude' } },
  { tool_name: 'Bash', tool_input: { command: 'docker compose up -d' } },
  { tool_name: 'Bash', tool_input: { command: 'echo "x" > a' } },
  { tool_name: 'WebFetch', tool_input: { url: 'https://x' } },
  { tool_name: 'Read', tool_input: { file_path: 'relativo.txt' } },
]);
ok(g.filter(x => x.kind === 'dir').map(x => x.value).join('|') === 'C:/Users/G/mkt-platform-mcp|C:/Users/G/.claude', 'arquivo vira a pasta dele, sem repetir; pasta fica ela');
ok(g.some(x => x.value === 'Bash(docker:*)') && g.some(x => x.value === 'Bash(echo:*)'), 'comando vira Bash(prefixo:*)');
ok(g.some(x => x.value === 'WebFetch'), 'ferramenta fora da lista');
ok(!g.some(x => x.value.includes('relativo')), 'caminho relativo não vira liberação');
ok(!f.safeGrant({ kind: 'tool', value: 'Bash(a" & del *:*)' }) && !f.safeGrant({ kind: 'dir', value: 'C:/a"b' }), 'aspas não passam');

const b = f.blockedDirs("ls in '/c/Users/G/x' was blocked. For security, ... test-path targeting 'C:/Users/G/mkt-platform-mcp' was blocked. For security, Claude Code may only");
ok(/^C:[\\/]Users[\\/]G[\\/]x$/i.test(b[0].value), 'caminho do Bash (/c/...) vira C:/...');
ok(b.length === 2 && b[1].kind === 'dir' && /mkt-platform-mcp$/.test(b[1].value), 'caminho barrado no terminal vira pasta para liberar');
ok(f.grantsFrom([{ tool_name: 'PowerShell', tool_input: { command: 'Test-Path C:/x' } }]).at(-1).value === 'PowerShell(Test-Path:*)', 'PowerShell também');

const ap = f.blockedDirs('This Bash command contains multiple operations. The following part requires approval: ls C:/Users/G/proj/electron');
ok(ap.length === 1 && /proj[\\/]electron$/.test(ap[0].value), 'parte que pede aprovação: a pasta do caminho');
const bash = f.grantsFrom([{ tool_name: 'Bash', tool_input: { command: 'git clone https://x C:/Users/G/mkt-platform-mcp && cat C:/Users/G/.claude/CLAUDE.md' } }]);
ok(bash[0].kind === 'dir' && /mkt-platform-mcp$/.test(bash[0].value) && /\.claude$/.test(bash[1].value) && bash.at(-1).value === 'Bash(git:*)', 'comando: as pastas dos caminhos primeiro, depois o comando');

rmSync(dir, { recursive: true, force: true });
console.log('permissions ok');
