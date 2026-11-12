/**
 * Limpeza do que os agentes deixam para trás (Utils > Limpeza). Primeiro levanta (scan), com o motivo de cada item; só
 * apaga o que o Gustavo marcou (clean). Nunca mexe no remoto nem em main/develop.
 * - Vídeos de entregas já revisadas (ou sem entrega).
 * - Worktrees das execuções que acabaram, cuja entrega já foi revisada, sem mudança por salvar.
 * - Branches locais já mergeadas (ou de tarefa feita: o merge squash não aparece no git) e que não são a atual.
 * - Pastas `.central-tmp/` (onde os agentes guardam o que é descartável).
 */
import { execFile } from 'node:child_process';
import { Dirent, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { DEV_ROOT, all, get, run } from './db';

const execFileP = promisify(execFile);
const git = async (cwd: string, args: string[]) => (await execFileP('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 60_000 })).stdout;

export const TMP_DIR = '.central-tmp';
/** entrega que ainda espera o Gustavo (ou está em ajuste): o que é dela fica */
const OPEN = `('pending','review','adjusting','paused')`;
const PROTECTED = /^(main|master|develop|dev|staging|production|prod|release\/.*|hotfix\/.*)$/;

export type Kind = 'video' | 'worktree' | 'branch' | 'temp';
export interface Item { kind: Kind; id: string; label: string; why: string; size: number | null; repo?: string; branch?: string }

/** tamanho de uma pasta (para no limite: worktree com node_modules pode ser enorme e demorado de somar) */
function sizeOf(path: string, budget = { n: 20_000 }): number {
  let total = 0;
  const walk = (p: string) => {
    if (budget.n-- <= 0) return;
    let s; try { s = statSync(p); } catch { return; }
    if (!s.isDirectory()) { total += s.size; return; }
    let names: string[] = []; try { names = readdirSync(p); } catch { return; }
    for (const n of names) walk(join(p, n));
  };
  walk(path);
  return total;
}

/**
 * Tamanho de uma pasta inteira, sem travar o processo (assíncrono, no máximo 48 leituras de disco ao mesmo tempo).
 * Não segue atalhos/junções (node_modules do pnpm): não conta duas vezes nem entra em laço.
 */
const slots = { free: 48, queue: [] as (() => void)[] };
const take = () => (slots.free > 0 ? (slots.free--, Promise.resolve()) : new Promise<void>(r => slots.queue.push(r)));
const give = () => { const next = slots.queue.shift(); if (next) next(); else slots.free++; };
export async function folderSize(path: string): Promise<number> {
  await take();
  let entries: Dirent[] | null = null;
  try { entries = await readdir(path, { withFileTypes: true }); } catch { /* sem acesso: conta zero */ } finally { give(); }
  if (!entries) return 0;
  const sizes = await Promise.all(entries.map(async e => {
    const p = join(path, e.name);
    if (e.isSymbolicLink()) return 0;
    if (e.isDirectory()) return folderSize(p);
    await take();
    try { return (await lstat(p)).size; } catch { return 0; } finally { give(); }
  }));
  return sizes.reduce((a, b) => a + b, 0);
}

/** mede as pastas uma a uma (avisando cada resultado), para a tela ir preenchendo */
export async function measureSizes(paths: string[], onSize: (id: string, size: number) => void): Promise<void> {
  for (const p of paths) {
    if (!resolve(p).startsWith(join(DEV_ROOT, '.central-worktrees'))) continue;
    onSize(p, await folderSize(p));
  }
}

function videos(videoDir: string): Item[] {
  if (!videoDir || !existsSync(videoDir)) return [];
  const open = new Set(all<{ video: string }>(`select video from deliveries where video is not null and status in ${OPEN}`).map(r => r.video));
  const known = new Map(all<{ video: string; title: string; status: string }>(`select video, title, status from deliveries where video is not null`).map(r => [r.video, r]));
  return readdirSync(videoDir).filter(f => !open.has(f)).map(f => {
    const d = known.get(f);
    return { kind: 'video' as const, id: join(videoDir, f), label: d ? d.title : f, why: d ? `entrega já revisada (${d.status})` : 'sem entrega ligada', size: statSync(join(videoDir, f)).size };
  });
}

/** mudança por salvar no worktree (o que está em .central-tmp não conta) */
async function dirty(path: string): Promise<boolean> {
  try { return (await git(path, ['status', '--porcelain'])).split('\n').some(l => l.trim() && !l.includes(TMP_DIR)); }
  catch { return false; }
}

async function worktrees(): Promise<Item[]> {
  const out: Item[] = [];
  const rows = all<{ path: string; repo: string; branch: string | null; busy: number; open: number; task_col: string | null }>(`
    select r.worktree_path path, max(r.repo_path) repo, max(r.branch) branch,
      max(r.status in ('queued','preparing','running')) busy,
      max(exists(select 1 from deliveries d where d.run_id = r.id and d.status in ${OPEN})) open,
      max((select "column" from tasks t where t.id = r.task_id)) task_col
    from runs r where r.worktree_path is not null group by r.worktree_path`);
  const seen = new Set<string>();
  for (const w of rows) {
    seen.add(w.path.toLowerCase());
    if (!existsSync(w.path) || w.busy || w.open) continue;
    // conversa recente continuando o trabalho nesta pasta (pedir ajuste)
    if (get(`select 1 from chats where cwd = ? and updated_at > ?`, w.path, new Date(Date.now() - 24 * 3600_000).toISOString())) continue;
    if (await dirty(w.path)) continue;
    out.push({ kind: 'worktree', id: w.path, label: w.path.replace(/\\/g, '/').split('/').slice(-2).join('/'), repo: w.repo, branch: w.branch ?? undefined,
      why: w.task_col === 'done' || w.task_col === 'dev' ? 'tarefa feita, entrega revisada' : 'execução acabou, nada esperando revisão', size: null });
  }
  // pastas de worktree que nenhuma execução conhece mais
  const root = join(DEV_ROOT, '.central-worktrees');
  if (existsSync(root)) for (const slug of readdirSync(root)) {
    let dirs: string[] = []; try { dirs = readdirSync(join(root, slug)); } catch { continue; }
    for (const d of dirs) {
      const p = join(root, slug, d);
      if (seen.has(p.toLowerCase()) || !statSync(p).isDirectory() || await dirty(p)) continue;
      out.push({ kind: 'worktree', id: p, label: `${slug}/${d}`, why: 'nenhuma execução usa esta pasta', size: null });
    }
  }
  return out;
}

async function branches(): Promise<Item[]> {
  const out: Item[] = [];
  const done = new Set(all<{ b: string }>(`select r.branch b from runs r left join tasks t on t.id = r.task_id
    left join deliveries d on d.run_id = r.id where r.branch is not null and (t."column" in ('done','dev') or d.status in ('approved','accepted'))`).map(r => r.b));
  for (const repo of all<{ path: string; name: string; default_branch: string | null }>('select path, name, default_branch from repos')) {
    if (!existsSync(repo.path)) continue;
    try {
      const current = (await git(repo.path, ['branch', '--show-current'])).trim();
      const local = (await git(repo.path, ['for-each-ref', 'refs/heads', '--format=%(refname:short)'])).split('\n').map(s => s.trim()).filter(Boolean);
      const merged = new Set<string>();
      for (const base of ['origin/develop', 'develop', `origin/${repo.default_branch ?? 'main'}`, repo.default_branch ?? 'main']) {
        try { for (const b of (await git(repo.path, ['branch', '--merged', base, '--format=%(refname:short)'])).split('\n')) if (b.trim()) merged.add(b.trim()); } catch { /* base não existe */ }
      }
      for (const b of local) {
        if (b === current || b === repo.default_branch || PROTECTED.test(b)) continue;
        const why = merged.has(b) ? 'já mergeada' : done.has(b) ? 'tarefa feita (merge squash)' : null;
        if (why) out.push({ kind: 'branch', id: `${repo.path}::${b}`, label: `${repo.name} · ${b}`, why, size: null, repo: repo.path, branch: b });
      }
    } catch { /* repositório com problema: pula */ }
  }
  return out;
}

function temps(): Item[] {
  const places = new Set<string>([
    ...all<{ p: string }>('select path p from repos').map(r => r.p),
    ...all<{ p: string }>('select distinct worktree_path p from runs where worktree_path is not null').map(r => r.p),
    DEV_ROOT,
  ]);
  const agents = join(DEV_ROOT, '.central-agents');
  if (existsSync(agents)) for (const a of readdirSync(agents)) places.add(join(agents, a));
  return [...places].map(p => join(p, TMP_DIR)).filter(p => existsSync(p))
    .map(p => ({ kind: 'temp' as const, id: p, label: p.replace(/\\/g, '/').split('/').slice(-3).join('/'), why: 'marcado como descartável pelo agente', size: sizeOf(p) }));
}

/** levanta tudo o que dá para limpar */
export async function scanHousekeeping(videoDir: string): Promise<Item[]> {
  const [w, b] = await Promise.all([worktrees(), branches()]);
  return [...videos(videoDir), ...w, ...b, ...temps()];
}

/** apaga o que foi marcado (worktrees antes das branches: a branch de um worktree só sai depois dele). Devolve o que não deu. */
export async function cleanHousekeeping(items: Item[], videoDir: string): Promise<{ done: number; failed: { label: string; why: string }[] }> {
  let done = 0;
  const failed: { label: string; why: string }[] = [];
  const order: Kind[] = ['video', 'temp', 'worktree', 'branch'];
  const repos = new Set<string>();
  for (const it of [...items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    try {
      if (it.kind === 'video') {
        // só dentro da pasta de vídeos da Central
        if (!videoDir || dirname(resolve(it.id)) !== resolve(videoDir)) throw new Error('fora da pasta de vídeos');
        rmSync(it.id, { force: true });
        run('update deliveries set video = null where video = ?', basename(it.id));
      } else if (it.kind === 'temp') {
        if (basename(resolve(it.id)) !== TMP_DIR) throw new Error('não é uma pasta .central-tmp');
        rmSync(it.id, { recursive: true, force: true, maxRetries: 3 });
      } else if (it.kind === 'worktree') {
        if (!resolve(it.id).startsWith(join(DEV_ROOT, '.central-worktrees') + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('fora de .central-worktrees');
        if (await dirty(it.id)) throw new Error('tem mudança por salvar');
        if (it.repo) { await git(it.repo, ['worktree', 'remove', '--force', it.id]).catch(() => {}); repos.add(it.repo); }
        if (existsSync(it.id)) rmSync(it.id, { recursive: true, force: true, maxRetries: 3 });
      } else {
        if (!it.repo || !it.branch || PROTECTED.test(it.branch)) throw new Error('branch protegida');
        await git(it.repo, ['branch', '-D', it.branch]);
      }
      done++;
    } catch (e) {
      failed.push({ label: it.label, why: (e as Error).message.split('\n')[0].slice(0, 200) });
    }
  }
  // pastas apagadas na mão (órfãs) também saem do registro de worktrees de cada repositório
  if (items.some(i => i.kind === 'worktree')) for (const r of new Set([...repos, ...all<{ p: string }>('select path p from repos').map(x => x.p)])) if (existsSync(r)) await git(r, ['worktree', 'prune']).catch(() => {});
  return { done, failed };
}
