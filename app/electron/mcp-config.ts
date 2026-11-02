/**
 * Arquivos --mcp-config que ligam sessões do Claude ao MCP da Central (definidos quando o servidor sobe).
 * Com escopo (conversa ou execução), a URL leva quem é (/mcp/run/12): assim set_status sabe de quem é o status.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let cfg: { file: string; dir: string; url: string; token: string } | null = null;

export const setMcpConfig = (c: typeof cfg) => { cfg = c; };

const body = (url: string, token: string) =>
  JSON.stringify({ mcpServers: { central: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

export function mcpConfigPath(scope?: { kind: 'chat' | 'run'; id: number }): string | null {
  if (!cfg) return null;
  if (!scope) return cfg.file;
  mkdirSync(cfg.dir, { recursive: true });
  const file = join(cfg.dir, `${scope.kind}-${scope.id}.json`);
  writeFileSync(file, body(`${cfg.url}/${scope.kind}/${scope.id}`, cfg.token));
  return file;
}

export { body as mcpConfigBody };
