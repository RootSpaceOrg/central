/** Saída do `claude mcp list` → lista (puro, para testar sem o Electron). */
export type McpKind = 'connector' | 'plugin' | 'own';
export type McpStatus = 'connected' | 'auth' | 'failed' | 'unknown';
export interface McpServer { name: string; target: string; status: McpStatus; kind: McpKind; tools_prefix: string }

/** uma linha do `claude mcp list`: "nome: alvo - ✔ Connected" */
export function parseList(out: string): McpServer[] {
  return out.split(/\r?\n/).map(l => /^(.+?): (.+) - (.+)$/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m).map(([, name, target, st]) => ({
    name, target: target.replace(/\s+\((HTTP|SSE|stdio)\)$/i, ''),
    status: /connected/i.test(st) ? 'connected' : /auth/i.test(st) ? 'auth' : /fail|error|✗/i.test(st) ? 'failed' : 'unknown',
    kind: name.startsWith('claude.ai ') ? 'connector' : name.startsWith('plugin:') ? 'plugin' : 'own',
    // como as ferramentas dele aparecem para o agente (é o que vai em "Ferramentas extras")
    tools_prefix: `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}`,
  }));
}

