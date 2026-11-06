/**
 * O que o Claude tentou e foi negado numa conversa (sem terminal, ninguém aprova na hora): vira itens que o Gustavo libera
 * com um clique. Pasta fora da sessão → --add-dir; comando ou ferramenta fora da lista → --allowedTools.
 */
import { basename, dirname, isAbsolute, resolve } from 'node:path';

export interface Grant { kind: 'dir' | 'tool'; value: string; label: string }

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS']);
/** nada que quebre a linha de comando (os valores vão entre aspas) */
export const safeGrant = (g: Pick<Grant, 'kind' | 'value'>) =>
  !/["\r\n]/.test(g.value) && (g.kind === 'dir' ? isAbsolute(g.value) : /^[\w.-]+(\([^()]*\))?$/.test(g.value));

/**
 * Comando de terminal mexendo fora das pastas da sessão: o Claude Code barra com "'<caminho>' was blocked. For security,
 * Claude Code may only access files in the allowed working directories". Não vem como pedido negado: lê o caminho do aviso.
 */
export function blockedDirs(text: string): Grant[] {
  const t = String(text);
  const blocked = [...t.matchAll(/'([^'\n]+)' was blocked\. For security/g)].map(m => m[1]);
  // "This Bash command contains multiple operations. The following part requires approval: ls C:/..."
  const parts = [...t.matchAll(/requires approval:\s*([^"\n]+)/g)].flatMap(m => pathsIn(m[1]));
  return [...blocked, ...parts].map(p => dirGrant(p, `Acesso bloqueado a ${p}`)).filter((g, i, l) => safeGrant(g) && l.findIndex(x => x.value === g.value) === i);
}

/** caminhos absolutos num comando (C:\..., C:/... ou /c/... do Git Bash) */
export function pathsIn(cmd: string): string[] {
  return [...String(cmd).matchAll(/(?:^|[\s"'=(])((?:[A-Za-z]:[\\/]|\/[a-zA-Z]\/)[^\s"'|;&<>()]*)/g)].map(m => m[1]);
}

/** pasta para liberar: o caminho (Git Bash → Windows); se for um arquivo, a pasta dele */
function dirGrant(p: string, label: string): Grant {
  const abs = resolve(p.replace(/^\/([a-z])\//i, '$1:/'));
  return { kind: 'dir', value: /.\.[\w-]+$/.test(basename(abs)) ? dirname(abs) : abs, label };
}

export function grantsFrom(denials: { tool_name?: string; tool_input?: Record<string, unknown> }[]): Grant[] {
  const out: Grant[] = [];
  for (const d of denials ?? []) {
    const name = String(d.tool_name ?? ''), input = d.tool_input ?? {};
    let g: Grant | null = null;
    if (FILE_TOOLS.has(name)) {
      const path = String(input['file_path'] ?? input['notebook_path'] ?? input['path'] ?? '');
      if (path && isAbsolute(path)) {
        // arquivo → a pasta dele; pasta (Glob/Grep/LS) → ela mesma
        const dir = !['Glob', 'Grep', 'LS'].includes(name) && /.\.[\w-]+$/.test(basename(path)) ? dirname(path) : path;
        g = { kind: 'dir', value: dir, label: `${name} em ${path}` };
      }
    } else if (name === 'Bash' || name === 'PowerShell') {
      const cmd = String(input['command'] ?? '').trim();
      const first = cmd.split(/\s+/)[0]?.replace(/^.*[\\/]/, '');
      // o comando costuma ser barrado pela pasta (fora da sessão): oferece a pasta antes do comando
      for (const p of pathsIn(cmd)) { const d = dirGrant(p, `Comando em ${p}`); if (safeGrant(d) && !out.some(x => x.value === d.value)) out.push(d); }
      if (first) g = { kind: 'tool', value: `${name}(${first}:*)`, label: `Comando: ${cmd.slice(0, 120)}` };
    } else if (name) g = { kind: 'tool', value: name, label: `Ferramenta: ${name}` };
    if (g && safeGrant(g) && !out.some(x => x.kind === g!.kind && x.value === g!.value)) out.push(g);
  }
  return out;
}
