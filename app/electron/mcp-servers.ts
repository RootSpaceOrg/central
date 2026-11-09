/**
 * Servidores MCP do Claude Code (os mesmos que os agentes enxergam): lista com o status, adiciona e remove pelo próprio
 * `claude mcp`. A checagem de saúde leva uns segundos (conecta em cada um): o resultado fica guardado alguns minutos.
 */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import { McpServer, parseList } from './mcp-parse';
import { childEnv } from './workspace';

export type { McpServer } from './mcp-parse';

const run = promisify(execFile);
const claude = (args: string[], timeout = 90_000) =>
  run('claude', args.map(a => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)), { shell: true, windowsHide: true, timeout, cwd: homedir(), env: childEnv(), maxBuffer: 4 * 1024 * 1024 });

let cache: { at: number; list: McpServer[] } | null = null;
let pending: Promise<McpServer[]> | null = null;

export async function listMcpServers(force = false): Promise<{ list: McpServer[]; checked_at: string | null }> {
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return { list: cache.list, checked_at: new Date(cache.at).toISOString() };
  pending ??= claude(['mcp', 'list']).then(r => parseList(r.stdout), e => { throw new Error(`Não deu para listar os MCPs: ${(e as Error).message.split('\n')[0]}`); })
    .finally(() => { pending = null; });
  const list = await pending;
  cache = { at: Date.now(), list };
  return { list, checked_at: new Date(cache.at).toISOString() };
}

const NAME = /^[A-Za-z0-9_-]{1,60}$/;

/** HTTP (url) ou stdio (comando com argumentos), no escopo do usuário: vale para todos os agentes e sessões */
export async function addMcpServer(input: { name: string; type: 'http' | 'sse' | 'stdio'; target: string; env?: Record<string, string> }): Promise<void> {
  const name = input.name.trim(), target = input.target.trim();
  if (!NAME.test(name)) throw new Error('Nome: só letras, números, - e _.');
  if (!target) throw new Error(input.type === 'stdio' ? 'Informe o comando.' : 'Informe a URL.');
  if (input.type !== 'stdio' && !/^https?:\/\//.test(target)) throw new Error('A URL precisa começar com http:// ou https://.');
  const env = Object.entries(input.env ?? {}).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const args = input.type === 'stdio'
    ? ['mcp', 'add', '-s', 'user', ...env, name, '--', ...target.split(/\s+/)]
    : ['mcp', 'add', '--transport', input.type, '-s', 'user', name, target];
  await claude(args, 30_000).catch(e => { throw new Error(`Não deu para adicionar: ${(e as Error).message.split('\n').slice(-2).join(' ')}`); });
  cache = null;
}

export async function removeMcpServer(name: string): Promise<void> {
  if (!NAME.test(name)) throw new Error('Só dá para remover os servidores que você adicionou (conectores e plugins são geridos no claude.ai e nos plugins).');
  await claude(['mcp', 'remove', name, '-s', 'user'], 30_000)
    .catch(() => claude(['mcp', 'remove', name], 30_000))
    .catch(e => { throw new Error(`Não deu para remover: ${(e as Error).message.split('\n').slice(-2).join(' ')}`); });
  cache = null;
}
