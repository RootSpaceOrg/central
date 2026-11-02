/**
 * "A caminho de produção": o que está em develop e ainda não está em main, por repositório, agrupado por PR, com há quanto
 * tempo espera e a nota de entrega quando veio de um agente. Lê do remoto (git fetch) no máximo a cada 10 min por projeto.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ReleaseItemDto, ReleaseRepoDto } from '../src/app/shared/contract';
import { all, get } from './db';

const execFileP = promisify(execFile);
const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; data: ReleaseRepoDto[] }>();

const git = async (cwd: string, args: string[], timeout = 20_000) =>
  (await execFileP('git', ['-C', cwd, ...args], { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 })).stdout;
const exists = (cwd: string, ref: string) => git(cwd, ['rev-parse', '--verify', '--quiet', ref]).then(() => true, () => false);

/** git@github.com:org/repo.git ou https://github.com/org/repo.git → https://github.com/org/repo */
export function webUrl(remote: string | null): string | null {
  if (!remote) return null;
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}` : null;
}

/** Back-merge (main/hotfix trazido de volta para develop): não é algo novo indo para produção. */
export const isBackMerge = (subject: string) => /back-?merge|^Merge (remote-tracking )?branch '(origin\/)?(main|master)'/i.test(subject);

/** Uma linha do first-parent de develop: merge de PR, squash "(#N)" ou commit direto. */
export function parseEntry(subject: string, body: string): { pr: number | null; title: string } {
  const merge = /^Merge pull request #(\d+) from \S+/.exec(subject);
  if (merge) return { pr: Number(merge[1]), title: body.split('\n').find(l => l.trim())?.trim() || subject };
  const squash = /^(.*)\s\(#(\d+)\)$/.exec(subject);
  if (squash) return { pr: Number(squash[2]), title: squash[1] };
  return { pr: null, title: subject };
}

async function repoStatus(path: string, name: string, remote: string | null, fetch: boolean): Promise<ReleaseRepoDto> {
  const base: ReleaseRepoDto = { path, name, prod: null, dev: null, commits: 0, items: [], oldest_at: null, error: null };
  try {
    if (fetch && remote) await git(path, ['fetch', 'origin', '--quiet', '--prune'], 45_000).catch(() => { base.error = 'não deu para buscar o remoto (offline?); mostrando o último conhecido'; });
    base.prod = (await exists(path, 'origin/main')) ? 'main' : (await exists(path, 'origin/master')) ? 'master' : null;
    base.dev = (await exists(path, 'origin/develop')) ? 'develop' : (await exists(path, 'origin/dev')) ? 'dev' : null;
    if (!base.prod || !base.dev) return base;
    const range = `origin/${base.prod}..origin/${base.dev}`;
    base.commits = Number((await git(path, ['rev-list', '--count', range])).trim());
    const raw = await git(path, ['log', range, '--first-parent', '--format=%H%x1f%ct%x1f%an%x1f%s%x1f%b%x1e']);
    const url = webUrl(remote);
    base.items = raw.split('\x1e').map(s => s.trim()).filter(Boolean).filter(rec => !isBackMerge(rec.split('\x1f')[3] ?? '')).map(rec => {
      const [sha, ct, author, subject, body = ''] = rec.split('\x1f');
      const { pr, title } = parseEntry(subject, body);
      const prUrl = pr && url ? `${url}/pull/${pr}` : null;
      const delivery = prUrl ? get<{ title: string; task_id: number | null }>('select title, task_id from deliveries where pr_url = ?', prUrl) : null;
      return { sha, at: new Date(Number(ct) * 1000).toISOString(), author, title, pr, url: prUrl, delivery: delivery?.title ?? null, task_id: delivery?.task_id ?? null } satisfies ReleaseItemDto;
    });
    base.oldest_at = base.items.at(-1)?.at ?? null;
  } catch (e) {
    base.error = String((e as Error).message ?? e).split('\n')[0].slice(0, 200);
  }
  return base;
}

/** Status de um projeto; refresh força buscar o remoto. */
export async function releaseStatus(slug: string, refresh = false): Promise<ReleaseRepoDto[]> {
  const hit = cache.get(slug);
  if (hit && !refresh && Date.now() - hit.at < TTL) return hit.data;
  const repos = all<{ path: string; name: string; remote: string | null }>('select path, name, remote from repos where project_slug = ? order by name', slug);
  const data = await Promise.all(repos.map(r => repoStatus(r.path, r.name, r.remote, true)));
  cache.set(slug, { at: Date.now(), data });
  return data;
}

/** Todos os projetos vivos (Visão geral): usa o cache; busca o que não tem. */
export async function releaseSummary(): Promise<{ slug: string; repos: ReleaseRepoDto[] }[]> {
  const slugs = all<{ slug: string }>(`select slug from projects where status <> 'dead'`).map(p => p.slug);
  return Promise.all(slugs.map(async slug => ({ slug, repos: await releaseStatus(slug) })));
}
