import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { CloneProgressDto, GithubRepoDto } from '../../contract';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { errorMessage } from '../../services/ipc/ipc.service';
import { PROJECT_COLORS, ProjectStatus, STATUS_LABEL } from '../../services/projects/projects.model';
import { ProjectsService, folderName } from '../../services/projects/projects.service';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'app-project-dialog',
  imports: [Icon],
  templateUrl: './project-dialog.html',
})
export class ProjectDialog {
  private readonly dialogs = inject(DialogsService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly state = this.dialogs.project;
  protected readonly cloneTarget = computed(() => {
    const s = this.state();
    return s?.mode === 'clone' ? this.projects.bySlug().get(s.slug) ?? null : null;
  });

  protected readonly colors = PROJECT_COLORS;
  protected readonly statuses = (Object.keys(STATUS_LABEL) as ProjectStatus[]).filter(s => s !== 'dead');
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly name = signal('');
  protected readonly folder = signal('');
  protected readonly folderEdited = signal(false);
  protected readonly status = signal<ProjectStatus>('active');
  protected readonly color = signal(PROJECT_COLORS[0]);
  protected readonly description = signal('');

  protected readonly github = signal<GithubRepoDto[] | null>(null);
  protected readonly githubError = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly selected = signal<string[]>([]);
  protected readonly progress = signal<Record<string, CloneProgressDto>>({});
  protected readonly createdSlug = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** criar como frente (subprojeto) deste projeto */
  protected readonly parent = computed(() => {
    const s = this.state();
    return s?.mode === 'create' && s.parentSlug ? this.projects.bySlug().get(s.parentSlug) ?? null : null;
  });
  /** frente nasce numa subpasta do grupo */
  protected readonly autoFolder = computed(() => {
    const base = this.parent()?.folder ?? this.projects.devRoot();
    return base && this.name().trim() ? `${base}\\${folderName(this.name())}` : '';
  });
  protected readonly effectiveFolder = computed(() => (this.folderEdited() ? this.folder() : this.autoFolder()));
  protected readonly matches = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.github() ?? [];
    return (q ? list.filter(r => r.full_name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)) : list).slice(0, 80);
  });
  protected readonly cloning = computed(() => Object.keys(this.progress()).length > 0);
  protected readonly cloneDone = computed(() => Object.values(this.progress()).every(p => p.state !== 'cloning'));

  constructor() {
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) { this.reset(); el.showModal(); this.loadGithub(); }
      if (!s && el.open) el.close();
    });
    this.projects.onCloneProgress(p => {
      if (p.full_name in this.progress()) this.progress.update(all => ({ ...all, [p.full_name]: p }));
    });
  }

  protected close(): void { this.state.set(null); }

  protected toggle(fullName: string): void {
    this.selected.update(s => (s.includes(fullName) ? s.filter(x => x !== fullName) : [...s, fullName]));
  }

  protected async pickFolder(): Promise<void> {
    const picked = await this.projects.pickFolder(this.effectiveFolder() || this.projects.devRoot());
    if (picked) { this.folder.set(picked); this.folderEdited.set(true); }
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.error.set(null);
    this.busy.set(true);
    try {
      let slug: string, folder: string;
      const target = this.cloneTarget();
      if (target) {
        ({ slug, folder } = target);
      } else {
        const p = await this.projects.create({
          name: this.name(), folder: this.effectiveFolder(), status: this.status(), color: this.color(), description: this.description(),
          parentSlug: this.parent()?.slug ?? null,
        });
        ({ slug, folder } = p);
      }
      this.createdSlug.set(slug);
      if (!this.selected().length) return this.open();
      this.progress.set(Object.fromEntries(this.selected().map(n => [n, { full_name: n, state: 'cloning', message: null } as CloneProgressDto])));
      for (const repo of this.selected()) await this.projects.clone(repo, folder);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected open(): void {
    const slug = this.createdSlug();
    this.close();
    if (slug) this.router.navigate(['/projetos', slug]);
  }

  private reset(): void {
    this.name.set(''); this.folder.set(''); this.folderEdited.set(false); this.status.set('active');
    this.color.set(PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]);
    this.description.set(''); this.query.set(''); this.selected.set([]); this.progress.set({});
    this.createdSlug.set(null); this.error.set(null); this.busy.set(false);
  }

  private loadGithub(): void {
    if (this.github()) return;
    this.projects.githubRepos()
      .then(list => this.github.set(list))
      .catch(e => this.githubError.set(`Não deu para listar seus repositórios do GitHub: ${errorMessage(e)}`));
  }
}
