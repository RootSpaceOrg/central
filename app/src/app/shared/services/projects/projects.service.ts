import { Injectable, computed, inject, signal } from '@angular/core';

import { CloneProgressDto, GithubRepoDto, ProjectDto, RepoDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { ProjectsApiService } from './projects-api.service';
import { NewProject, Project, ProjectEdit, ProjectStatus, Repo } from './projects.model';

const toProject = (d: ProjectDto): Project => ({
  slug: d.slug,
  name: d.name,
  folder: d.folder,
  status: d.status,
  color: d.color,
  description: d.description,
  iconKind: d.icon_kind ?? 'letter',
  iconValue: d.icon_value,
  folderExists: d.folder_exists,
  repoCount: d.repo_count,
  dirtyRepos: d.dirty_repos,
  commits7d: d.commits_7d,
  commits30d: d.commits_30d,
  spark: d.spark,
  lastCommitAt: d.last_commit_at ? new Date(d.last_commit_at) : null,
  lastCommitSubject: d.last_commit_subject,
  lastCommitRepo: d.last_commit_repo,
  openProposals: d.open_proposals,
  activeRuns: d.active_runs,
  parentSlug: d.parent_slug ?? null,
  position: d.position ?? 0,
  todoAgentId: d.todo_agent_id ?? null,
  todoParallel: d.todo_parallel ?? 1,
  todoHours: d.todo_hours ?? '',
  doneWhen: d.done_when === 'prod' ? 'prod' : 'merge',
});

/** git@github.com:o/r.git | https://github.com/o/r.git → https://github.com/o/r */
export function githubUrl(remote: string | null): string | null {
  const m = remote?.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

const toRepo = (d: RepoDto): Repo => ({
  path: d.path,
  name: d.name,
  url: githubUrl(d.remote),
  defaultBranch: d.default_branch,
  branch: d.branch,
  dirty: d.dirty,
  ahead: d.ahead,
  behind: d.behind,
  lastCommitAt: d.last_commit_at ? new Date(d.last_commit_at) : null,
  lastCommitSubject: d.last_commit_subject,
});

/** Nome → pasta no seu padrão: "Mapa Edu" → "MapaEdu". */
export function folderName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly api = inject(ProjectsApiService);

  readonly projects = signal<Project[]>([]);
  readonly loaded = signal(false);
  readonly syncing = signal(false);
  readonly lastSync = signal<Date | null>(null);
  readonly devRoot = signal('');
  readonly error = signal<string | null>(null);

  readonly living = computed(() => this.projects().filter(p => p.status !== 'dead'));
  readonly dead = computed(() => this.projects().filter(p => p.status === 'dead'));
  readonly bySlug = computed(() => new Map(this.projects().map(p => [p.slug, p])));
  /** projeto que aparece escolhido por padrão: o mais movimentado da semana */
  readonly defaultSlug = computed(() => [...this.living()].sort((a, b) =>
    b.commits7d - a.commits7d || (b.lastCommitAt?.getTime() ?? 0) - (a.lastCommitAt?.getTime() ?? 0))[0]?.slug ?? '');

  constructor() {
    this.api.onChanged(() => { this.syncing.set(false); this.lastSync.set(new Date()); this.load(); });
    this.api.info().then(i => this.devRoot.set(i.dev_root));
    this.syncing.set(true); // o main sincroniza tudo ao abrir
    this.load();
  }

  load(): void {
    this.api.list()
      .then(list => { this.projects.set(list.map(toProject)); this.loaded.set(true); })
      .catch(e => this.error.set(errorMessage(e)));
  }

  sync(slug: string | null = null): void {
    this.syncing.set(true);
    this.api.sync(slug).catch(e => { this.syncing.set(false); this.error.set(errorMessage(e)); });
  }

  async create(p: NewProject): Promise<Project> {
    const dto = await this.api.create({
      name: p.name, folder: p.folder, status: p.status, color: p.color, description: p.description || null, parent_slug: p.parentSlug ?? null,
    });
    this.load();
    return toProject(dto);
  }

  /** subprojetos (frentes) de um projeto-grupo, na ordem da barra lateral */
  children(slug: string): Project[] { return this.projects().filter(p => p.parentSlug === slug).sort((a, b) => a.position - b.position); }

  /** "MatrizTech › Livros" para subprojetos */
  fullName(p: Project): string {
    const parent = p.parentSlug ? this.bySlug().get(p.parentSlug) : null;
    return parent ? `${parent.name} › ${p.name}` : p.name;
  }

  /** Nova ordem de irmãos (barra lateral): aplica na hora e salva. */
  reorder(slugs: string[]): void {
    const pos = new Map(slugs.map((s, i) => [s, i]));
    this.projects.update(list => list.map(p => (pos.has(p.slug) ? { ...p, position: pos.get(p.slug)! } : p)));
    this.api.reorder(slugs).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  setStatus(slug: string, status: ProjectStatus): void {
    this.patchLocal(slug, { status });
    this.api.update(slug, { status }).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  /** Responsável pelo "A fazer": agente, quantas por vez, horário. Lança o erro para a tela mostrar. */
  async setTodoOwner(slug: string, patch: { agentId?: number | null; parallel?: number; hours?: string }): Promise<void> {
    const p = this.bySlug().get(slug);
    if (p) this.projects.update(list => list.map(x => (x.slug === slug ? { ...x, todoAgentId: patch.agentId === undefined ? x.todoAgentId : patch.agentId,
      todoParallel: patch.parallel ?? x.todoParallel, todoHours: patch.hours ?? x.todoHours } : x)));
    try {
      await this.api.update(slug, { todo_agent_id: patch.agentId, todo_parallel: patch.parallel, todo_hours: patch.hours });
    } catch (e) {
      this.load();
      throw new Error(errorMessage(e));
    }
  }

  setDescription(slug: string, description: string): void {
    this.patchLocal(slug, { description: description || null });
    this.api.update(slug, { description: description || null }).catch(e => this.error.set(errorMessage(e)));
  }

  /** Edição completa (nome, ícone, cor, pasta…). Lança o erro para o formulário mostrar. */
  async edit(slug: string, e: ProjectEdit): Promise<void> {
    try {
      await this.api.update(slug, {
        name: e.name, status: e.status, color: e.color, description: e.description,
        icon_kind: e.iconKind, icon_value: e.iconValue, folder: e.folder, parent_slug: e.parentSlug, done_when: e.doneWhen,
      });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
    this.load();
  }

  async remove(slug: string): Promise<void> {
    try {
      await this.api.remove(slug);
    } catch (err) {
      throw new Error(errorMessage(err));
    }
    this.load();
  }

  async pickImage(): Promise<string | null> {
    try {
      return await this.api.pickImage();
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async repos(slug: string): Promise<Repo[]> {
    return (await this.api.repos(slug)).map(toRepo);
  }

  githubRepos(): Promise<GithubRepoDto[]> { return this.api.githubRepos(); }
  clone(fullName: string, folder: string) { return this.api.clone(fullName, folder); }
  onCloneProgress(cb: (p: CloneProgressDto) => void) { return this.api.onCloneProgress(cb); }
  pickFolder(defaultPath: string) { return this.api.pickFolder(defaultPath); }
  reveal(path: string) { this.api.reveal(path); }
  openInVsCode(path: string) { this.api.openInVsCode(path); }
  openExternal(url: string) { this.api.openExternal(url); }

  private patchLocal(slug: string, patch: Partial<Project>): void {
    this.projects.update(list => list.map(p => (p.slug === slug ? { ...p, ...patch } : p)));
  }
}
