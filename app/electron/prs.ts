/**
 * Utils → Pull Requests: os PRs abertos que envolvem o Gustavo, como o inbox do GitHub (github.com/pulls): criados por
 * ele, atribuídos, mencionado, revisão pedida. Busca pelo `gh` logado; cada PR ganha o estado do CI, da revisão e o
 * projeto/tarefa da Central a que pertence. Cache curto para a tela não martelar a API.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { PrFilter, PrItemDto } from '../src/app/shared/contract';
import { all, get } from './db';
import { pool } from './git';

const execFileP = promisify(execFile);
const TTL = 90_000;
const cache = new Map<PrFilter, { at: number; items: PrItemDto[] }>();
/** detalhe de cada PR (CI, revisão…) por url: só busca de novo se o PR mudou */
const details = new Map<string, { updated: string; d: Record<string, any> }>();

const FLAG: Record<PrFilter, string[]> = {
  created: ['--author', '@me'], assigned: ['--assignee', '@me'], mentioned: ['--mentions', '@me'],
  review: ['--review-requested', '@me'], involves: ['--involves', '@me'],
};

const gh = async (args: string[]) => (await execFileP('gh', args, { windowsHide: true, timeout: 45_000, maxBuffer: 8 * 1024 * 1024 })).stdout;

/** github.com/dono/repo (do remote do repositório) → projeto da Central */
function projectOf(nameWithOwner: string): { slug: string; name: string } | null {
  const key = nameWithOwner.toLowerCase();
  const repos = all<{ remote: string | null; slug: string }>('select remote, project_slug slug from repos where remote is not null');
  const hit = repos.find(r => (r.remote ?? '').toLowerCase().replace(/\.git$/, '').endsWith(key));
  if (!hit) return null;
  const p = get<{ name: string }>('select name from projects where slug = ?', hit.slug);
  return p ? { slug: hit.slug, name: p.name } : null;
}

export async function listPrs(filter: PrFilter, fresh = false): Promise<PrItemDto[]> {
  const c = cache.get(filter);
  if (c && !fresh && Date.now() - c.at < TTL) return c.items;
  const raw = JSON.parse(await gh(['search', 'prs', ...FLAG[filter], '--state', 'open', '--limit', '60', '--sort', 'updated',
    '--json', 'number,title,url,repository,author,createdAt,updatedAt,isDraft,commentsCount,labels'])) as {
    number: number; title: string; url: string; repository: { nameWithOwner: string; name: string }; author: { login: string; is_bot?: boolean };
    createdAt: string; updatedAt: string; isDraft: boolean; commentsCount: number; labels: { name: string; color?: string }[];
  }[];
  // detalhes que a busca não traz (CI, revisão, branches, tamanho), em paralelo e sem derrubar a lista se um falhar
  const items: PrItemDto[] = [];
  await pool(raw, 6, async r => {
    let d: { statusCheckRollup?: { state?: string; conclusion?: string; status?: string }[]; reviewDecision?: string; headRefName?: string; baseRefName?: string;
      additions?: number; deletions?: number; mergeable?: string } = {};
    const known = details.get(r.url);
    if (known && known.updated === r.updatedAt) d = known.d;
    else try {
      d = JSON.parse(await gh(['pr', 'view', r.url, '--json', 'statusCheckRollup,reviewDecision,headRefName,baseRefName,additions,deletions,mergeable']));
      details.set(r.url, { updated: r.updatedAt, d });
    } catch { /* sem acesso: fica sem detalhe */ }
    const checks = d.statusCheckRollup ?? [];
    const failed = checks.some(x => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(x.conclusion ?? x.state ?? ''));
    const pending = checks.some(x => x.status && x.status !== 'COMPLETED' || x.state === 'PENDING');
    const task = get<{ id: number; title: string }>('select id, title from tasks where pr_url = ? order by id desc limit 1', r.url);
    items.push({
      number: r.number, title: r.title, url: r.url, repo: r.repository.nameWithOwner, author: r.author?.login ?? '?', bot: !!r.author?.is_bot,
      created_at: r.createdAt, updated_at: r.updatedAt, draft: r.isDraft, comments: r.commentsCount, labels: (r.labels ?? []).map(l => ({ name: l.name, color: l.color ?? null })),
      checks: !checks.length ? 'none' : failed ? 'failure' : pending ? 'pending' : 'success',
      review: (d.reviewDecision as PrItemDto['review']) || null, head: d.headRefName ?? null, base: d.baseRefName ?? null,
      additions: d.additions ?? null, deletions: d.deletions ?? null, conflict: d.mergeable === 'CONFLICTING',
      project: projectOf(r.repository.nameWithOwner), task: task ?? null,
    });
  });
  items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  cache.set(filter, { at: Date.now(), items });
  return items;
}
