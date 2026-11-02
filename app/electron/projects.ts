import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { CommitDto, NewProjectInput, ProjectDto, ProjectPatch, ProjectStatus, RepoDto } from '../src/app/shared/contract';
import { all, get, now, run } from './db';
import { findRepos, pool, recentCommits, repoStatus } from './git';

const STATUSES: ProjectStatus[] = ['active', 'maintenance', 'frozen', 'dead'];
const DAY = 86_400_000;

type ProjectRow = Omit<ProjectDto, 'folder_exists' | 'repo_count' | 'dirty_repos' | 'commits_7d' | 'commits_30d' | 'spark'
  | 'last_commit_at' | 'last_commit_subject' | 'last_commit_repo' | 'open_proposals' | 'active_runs'>;

export function listProjects(): ProjectDto[] {
  const rows = all<ProjectRow & { repo_count: number; dirty_repos: number; open_proposals: number; active_runs: number }>(`
    select p.*,
      (select count(*) from repos r where r.project_slug = p.slug) repo_count,
      (select count(*) from repos r where r.project_slug = p.slug and r.dirty > 0) dirty_repos,
      (select count(*) from proposals x where x.project_slug = p.slug and x.status = 'proposed') open_proposals,
      (select count(*) from runs x where x.project_slug = p.slug and x.status in ('queued','preparing','running')) active_runs
    from projects p
    order by case p.status when 'active' then 0 when 'maintenance' then 1 when 'frozen' then 2 else 3 end, p.position, p.name`);

  const since14 = new Date(Date.now() - 13 * DAY).toISOString().slice(0, 10);
  const daily = all<{ slug: string; day: string; n: number }>(`
    select r.project_slug slug, substr(c.committed_at, 1, 10) day, count(*) n
    from commits c join repos r on r.path = c.repo_path
    where c.committed_at >= ? group by 1, 2`, since14);
  const totals = all<{ slug: string; d7: number; d30: number }>(`
    select r.project_slug slug,
      sum(c.committed_at >= ?) d7, sum(c.committed_at >= ?) d30
    from commits c join repos r on r.path = c.repo_path group by 1`,
    new Date(Date.now() - 7 * DAY).toISOString(), new Date(Date.now() - 30 * DAY).toISOString());
  const last = all<{ slug: string; committed_at: string; subject: string; repo: string }>(`
    select slug, committed_at, subject, repo from (
      select r.project_slug slug, c.committed_at, c.subject, r.name repo,
             row_number() over (partition by r.project_slug order by c.committed_at desc) rn
      from commits c join repos r on r.path = c.repo_path) where rn = 1`);

  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10));
  return rows.map(p => {
    const t = totals.find(x => x.slug === p.slug);
    const l = last.find(x => x.slug === p.slug);
    return {
      ...p,
      folder_exists: existsSync(p.folder),
      commits_7d: t?.d7 ?? 0,
      commits_30d: t?.d30 ?? 0,
      spark: days.map(d => daily.find(x => x.slug === p.slug && x.day === d)?.n ?? 0),
      last_commit_at: l?.committed_at ?? null,
      last_commit_subject: l?.subject ?? null,
      last_commit_repo: l?.repo ?? null,
    };
  });
}

export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export function createProject(input: NewProjectInput): ProjectDto {
  const name = input.name?.trim();
  if (!name) throw new Error('Dê um nome ao projeto.');
  if (!input.folder?.trim()) throw new Error('Escolha a pasta do projeto.');
  if (!isAbsolute(input.folder.trim())) throw new Error('Use o caminho completo da pasta, por exemplo C:\\Users\\voce\\Development\\Projeto.');
  if (!STATUSES.includes(input.status)) throw new Error('Status inválido.');
  const folder = resolve(input.folder.trim());
  if (get('select 1 from projects where folder = ?', folder)) throw new Error('Essa pasta já é de outro projeto.');

  let slug = slugify(name) || 'projeto';
  for (let i = 2; get('select 1 from projects where slug = ?', slug); i++) slug = `${slugify(name)}-${i}`;

  const parent = input.parent_slug ? checkParent(slug, input.parent_slug) : null;
  mkdirSync(folder, { recursive: true });
  const position = (get<{ p: number | null }>('select max(position) p from projects')?.p ?? 0) + 1;
  run('insert into projects (slug, name, folder, status, color, description, parent_slug, position) values (?,?,?,?,?,?,?,?)',
    slug, name, folder, input.status, input.color, input.description?.trim() || null, parent, position);
  return listProjects().find(p => p.slug === slug)!;
}

/** Um nível só: o grupo não pode ser subprojeto, e um projeto com frentes não vira frente de outro. */
function checkParent(slug: string, parent: string): string {
  if (parent === slug) throw new Error('Um projeto não pode ser subprojeto dele mesmo.');
  const p = get<{ parent_slug: string | null }>('select parent_slug from projects where slug = ?', parent);
  if (!p) throw new Error('Projeto-grupo não encontrado.');
  if (p.parent_slug) throw new Error('Esse projeto já é um subprojeto: escolha o projeto de cima.');
  if (get('select 1 from projects where parent_slug = ?', slug)) throw new Error('Este projeto tem subprojetos: ele é um grupo e não pode ficar dentro de outro.');
  return parent;
}

/** Nova ordem de irmãos na barra lateral. */
export function reorderProjects(slugs: string[]): void {
  run('begin');
  try { slugs.forEach((s, i) => run('update projects set position = ? where slug = ?', i, s)); run('commit'); }
  catch (e) { run('rollback'); throw e; }
}

const ICON_KINDS = ['letter', 'emoji', 'lucide', 'image'];
const MAX_IMAGE = 400 * 1024;

export function updateProject(slug: string, patch: ProjectPatch): void {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error('Projeto não encontrado.');
  if (patch.status && !STATUSES.includes(patch.status)) throw new Error('Status inválido.');
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('O nome não pode ficar vazio.');
  if (patch.icon_kind && !ICON_KINDS.includes(patch.icon_kind)) throw new Error('Tipo de ícone inválido.');
  if (patch.icon_kind === 'image' && !/^data:image\/(png|jpeg|webp|svg\+xml|gif);base64,/.test(patch.icon_value ?? '')) {
    throw new Error('Imagem inválida.');
  }
  if ((patch.icon_value?.length ?? 0) > MAX_IMAGE * 1.4) throw new Error('Imagem grande demais (máximo 400 KB).');
  if (patch.folder !== undefined) {
    if (!isAbsolute(patch.folder.trim())) throw new Error('Use o caminho completo da pasta.');
    patch.folder = resolve(patch.folder.trim());
    if (get('select 1 from projects where folder = ? and slug <> ?', patch.folder, slug)) throw new Error('Essa pasta já é de outro projeto.');
  }
  if (patch.parent_slug) checkParent(slug, patch.parent_slug);
  const fields = Object.entries(patch)
    // campo ausente chega como undefined pelo IPC: não mexe nele (senão vira null e quebra colunas NOT NULL, ex.: folder)
    .filter(([k, v]) => v !== undefined && ['name', 'status', 'color', 'description', 'icon_kind', 'icon_value', 'folder', 'parent_slug'].includes(k))
  if (!fields.length) return;
  run(`update projects set ${fields.map(([k]) => `${k} = ?`).join(', ')} where slug = ?`,
    ...fields.map(([k, v]) => (typeof v === 'string' && k !== 'icon_value' ? v.trim() : v ?? null) as string | number | null), slug);
}

/** Tira o projeto da Central. Pasta, repositórios e worktrees continuam no disco. */
export function deleteProject(slug: string): void {
  if (get<{ n: number }>(`select count(*) n from runs where project_slug = ? and status in ('queued','preparing','running')`, slug)!.n) {
    throw new Error('Há agentes trabalhando neste projeto. Interrompa antes de excluir.');
  }
  run('update ideas set project_slug = null where project_slug = ?', slug);
  run('update proposals set project_slug = null where project_slug = ?', slug);
  // subprojetos ficam soltos (viram projetos de primeiro nível)
  run('update projects set parent_slug = null where parent_slug = ?', slug);
  run('delete from projects where slug = ?', slug);
}

export function listRepos(slug: string): RepoDto[] {
  return all<RepoDto>(`
    select r.path, r.project_slug, r.name, r.remote, r.default_branch, r.branch, r.dirty, r.ahead, r.behind,
      (select max(committed_at) from commits c where c.repo_path = r.path) last_commit_at,
      (select subject from commits c where c.repo_path = r.path order by committed_at desc limit 1) last_commit_subject
    from repos r where r.project_slug = ?
    order by last_commit_at desc nulls last, r.name`, slug);
}

export function recent(slug: string | null, days: number, limit: number): CommitDto[] {
  const since = new Date(Date.now() - days * DAY).toISOString();
  return all<CommitDto>(`
    select c.repo_path, r.name repo_name, r.project_slug, c.sha, c.committed_at, c.author, c.subject
    from commits c join repos r on r.path = c.repo_path
    join projects p on p.slug = r.project_slug
    where c.committed_at >= ? and (? is null and p.status <> 'dead' or r.project_slug = ?)
    order by c.committed_at desc limit ?`, since, slug, slug, limit);
}

let queue: Promise<void> = Promise.resolve();

/**
 * Redescobre repos da pasta, atualiza status git e indexa commits dos últimos 60 dias.
 * Sincronizações entram numa fila: um pedido feito durante outra não se perde.
 */
export function syncProjects(slug: string | null, onDone: () => void): Promise<void> {
  queue = queue.then(() => syncNow(slug)).catch(e => console.error('sync', e)).then(onDone);
  return queue;
}

async function syncNow(slug: string | null): Promise<void> {
  const projects = all<{ slug: string; folder: string }>(
    slug ? 'select slug, folder from projects where slug = ?' : "select slug, folder from projects where status <> 'dead'",
    ...(slug ? [slug] : []));

  const work: { slug: string; path: string }[] = [];
  // pasta dentro da pasta de outro projeto (subprojeto numa subpasta): o repositório é do projeto mais específico
  const folders = all<{ slug: string; folder: string }>('select slug, folder from projects');
  const under = (path: string, folder: string) => path.toLowerCase().startsWith(`${folder.toLowerCase().replace(/[\\/]+$/, '')}\\`);
  for (const p of projects) {
    const inner = folders.filter(o => o.slug !== p.slug && o.folder.length > p.folder.length && under(o.folder, p.folder));
    const paths = findRepos(p.folder).filter(path => !inner.some(o => path === o.folder || under(path, o.folder)));
    run(`delete from repos where project_slug = ? and path not in (${paths.map(() => '?').join(',') || "''"})`, p.slug, ...paths);
    work.push(...paths.map(path => ({ slug: p.slug, path })));
  }
  await pool(work, 8, async ({ slug, path }) => {
    const [s, commits] = await Promise.all([repoStatus(path), recentCommits(path, 60)]);
    run(`insert into repos (path, project_slug, name, remote, default_branch, branch, dirty, ahead, behind, scanned_at)
         values (?,?,?,?,?,?,?,?,?,?)
         on conflict (path) do update set project_slug = excluded.project_slug, name = excluded.name,
           remote = excluded.remote, default_branch = excluded.default_branch, branch = excluded.branch,
           dirty = excluded.dirty, ahead = excluded.ahead, behind = excluded.behind, scanned_at = excluded.scanned_at`,
      path, slug, s.name, s.remote, s.defaultBranch, s.branch, s.dirty, s.ahead, s.behind, now());
    const insert = 'insert or ignore into commits (repo_path, sha, committed_at, author, subject) values (?,?,?,?,?)';
    run('begin');  // síncrono daqui até o commit: nenhum outro repo intercala
    try { for (const c of commits) run(insert, path, c.sha, c.committedAt, c.author, c.subject); run('commit'); }
    catch (e) { run('rollback'); throw e; }
  });
}
