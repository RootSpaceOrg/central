/** Arquivos, terminais e GitHub: o lado "IDE" da Central. */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import * as pty from '@lydell/node-pty';

import type { CloneProgressDto, FileDto, FsEntryDto, GithubRepoDto, NewTerminalInput } from '../src/app/shared/contract';
import { all } from './db';
import { mcpConfigPath } from './mcp-config';

const execFileP = promisify(execFile);
const MAX_FILE = 2 * 1024 * 1024;
const HIDDEN = new Set(['.git']);

/** Ambiente para processos filhos, sem as marcas de sessão de um Claude Code que tenha aberto o app. */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env, ...extra } as Record<string, string>;
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[k];
  return env;
}

/** Só caminhos dentro da pasta de algum projeto. */
function guard(path: string): string {
  const abs = resolve(path);
  const inside = all<{ folder: string }>('select folder from projects').some(({ folder }) => {
    const rel = relative(resolve(folder), abs);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
  if (!inside) throw new Error('Caminho fora das pastas dos projetos.');
  return abs;
}

export function listDir(dir: string): FsEntryDto[] {
  const abs = guard(dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter(e => !HIDDEN.has(e.name))
    .map(e => ({ name: e.name, path: join(abs, e.name), dir: e.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

export function readFile(path: string): FileDto {
  const abs = guard(path);
  if (statSync(abs).size > MAX_FILE) return { path: abs, content: null, reason: 'Arquivo maior que 2 MB.' };
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return { path: abs, content: null, reason: 'Arquivo binário.' };
  return { path: abs, content: buf.toString('utf8'), reason: null };
}

export function writeFile(path: string, content: string): void {
  writeFileSync(guard(path), content, 'utf8');
}

// ---------- terminais ----------

// "bash.exe" solto no PATH costuma ser o do WSL: procura o Git Bash nos lugares do instalador
const GIT_BASH = [join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe'), join(process.env.LOCALAPPDATA ?? '', 'Programs/Git/bin/bash.exe')]
  .find(p => existsSync(p)) ?? 'bash.exe';
const SHELLS: Record<string, [string, string[]]> = {
  shell: ['powershell.exe', ['-NoLogo']],
  cmd: ['cmd.exe', []],
  bash: [GIT_BASH, ['--login', '-i']],
};

const terminals = new Map<number, pty.IPty>();
let nextTerminal = 1;

export function createTerminal(input: NewTerminalInput, promptFile: string | null, onData: (id: number, d: string) => void, onExit: (id: number, code: number) => void): number {
  const cwd = guard(input.cwd);
  if (!existsSync(cwd)) throw new Error(`A pasta ${cwd} não existe. Ajuste a pasta do projeto em Editar projeto.`);
  let [file, args] = SHELLS[input.kind === 'claude' ? 'shell' : input.kind] ?? SHELLS.shell;
  if (input.kind === 'claude') {
    // a sessão interativa também enxerga e atualiza a Central (backlog, ideias, decisões)
    const mcp = mcpConfigPath();
    const extra = [mcp ? `--mcp-config '${mcp}'` : '', promptFile ? `--append-system-prompt-file '${promptFile}'` : ''].filter(Boolean).join(' ');
    args = [...args, '-NoExit', '-Command', `claude ${extra}`.trim()];
  }
  const term = pty.spawn(file, args, {
    name: 'xterm-256color', cwd, cols: input.cols || 100, rows: input.rows || 30,
    env: childEnv({ TERM_PROGRAM: 'Central' }),
  });
  const id = nextTerminal++;
  terminals.set(id, term);
  term.onData(d => onData(id, d));
  term.onExit(({ exitCode }) => { terminals.delete(id); onExit(id, exitCode); });
  return id;
}

export const writeTerminal = (id: number, data: string) => terminals.get(id)?.write(data);
export const resizeTerminal = (id: number, cols: number, rows: number) => {
  if (cols > 0 && rows > 0) terminals.get(id)?.resize(cols, rows);
};
export const killTerminal = (id: number) => { terminals.get(id)?.kill(); terminals.delete(id); };
export const killAllTerminals = () => { for (const id of [...terminals.keys()]) killTerminal(id); };

// ---------- GitHub ----------

let repoCache: { at: number; repos: GithubRepoDto[] } | null = null;

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileP('gh', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return stdout;
}

/** Todos os repos da sua conta e das suas orgs. Cache de 10 min. */
export async function githubRepos(): Promise<GithubRepoDto[]> {
  if (repoCache && Date.now() - repoCache.at < 600_000) return repoCache.repos;
  const owners = [(await gh(['api', 'user', '-q', '.login'])).trim(), ...(await gh(['org', 'list'])).split(/\s+/).filter(Boolean)];
  const lists = await Promise.all(owners.map(async o => {
    const raw = JSON.parse(await gh(['repo', 'list', o, '--limit', '1000', '--json', 'nameWithOwner,description,pushedAt,url']));
    return raw.map((r: any): GithubRepoDto => ({ full_name: r.nameWithOwner, description: r.description || null, pushed_at: r.pushedAt, url: r.url }));
  }));
  const repos = lists.flat().sort((a, b) => b.pushed_at.localeCompare(a.pushed_at));
  repoCache = { at: Date.now(), repos };
  return repos;
}

export function cloneRepo(fullName: string, folder: string, progress: (p: CloneProgressDto) => void, done: () => void): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error('Repositório inválido.');
  const target = join(guard(folder), fullName.split('/')[1]);
  if (existsSync(target)) {
    progress({ full_name: fullName, state: 'done', message: 'Já estava clonado.' });
    return done();
  }
  progress({ full_name: fullName, state: 'cloning', message: null });
  const child = spawn('gh', ['repo', 'clone', fullName, target], { windowsHide: true });
  let err = '';
  child.stderr.on('data', d => { err = (err + d).slice(-2000); });
  child.on('close', code => {
    progress({ full_name: fullName, state: code === 0 ? 'done' : 'error', message: code === 0 ? null : err.trim() });
    done();
  });
}
