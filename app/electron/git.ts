import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', cwd, ...args], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return stdout;
}

export async function gitOr(cwd: string, args: string[], fallback: string): Promise<string> {
  try { return await git(cwd, args); } catch { return fallback; }
}

const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', '.angular', 'vendor', '.terraform', '.central', '.claude']);

/** Clones reais dentro da pasta do projeto. Worktree (.git é arquivo) fica de fora. */
export function findRepos(root: string, maxDepth = 3): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    const dotGit = join(dir, '.git');
    if (existsSync(dotGit) && statSync(dotGit).isDirectory()) { found.push(dir); return; }
    if (depth === maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      const child = join(dir, name);
      try { if (statSync(child).isDirectory()) walk(child, depth + 1); } catch { /* sem permissão */ }
    }
  };
  if (existsSync(root)) walk(root, 0);
  return found;
}

export interface RepoStatus {
  name: string;
  remote: string | null;
  defaultBranch: string | null;
  branch: string | null;
  dirty: number;
  ahead: number;
  behind: number;
}

export async function repoStatus(path: string): Promise<RepoStatus> {
  const [status, remote, head] = await Promise.all([
    gitOr(path, ['status', '--porcelain=v2', '--branch'], ''),
    gitOr(path, ['remote', 'get-url', 'origin'], ''),
    gitOr(path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], ''),
  ]);
  return { name: basename(path), remote: remote.trim() || null, defaultBranch: head.trim().replace(/^origin\//, '') || null, ...parseStatus(status) };
}

export function parseStatus(out: string): { branch: string | null; dirty: number; ahead: number; behind: number } {
  let branch: string | null = null, ahead = 0, behind = 0, dirty = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { ahead = +m[1]; behind = +m[2]; }
    } else if (line.trim() && !line.startsWith('#')) dirty++;
  }
  return { branch: branch === '(detached)' ? null : branch, dirty, ahead, behind };
}

export interface Commit { sha: string; committedAt: string; author: string; subject: string }

export async function recentCommits(path: string, days: number): Promise<Commit[]> {
  const out = await gitOr(path, ['log', '--all', `--since=${days}.days`, '--format=%H%x1f%cI%x1f%an%x1f%s'], '');
  return out.split('\n').filter(Boolean).map(line => {
    const [sha, date, author, subject] = line.split('\x1f');
    return { sha, committedAt: new Date(date).toISOString(), author, subject };
  });
}

/** Roda fn sobre items com no máximo `limit` em paralelo. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}
