import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

import { IDEA_SOURCE_LABEL, Idea, IdeaStatus, IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';

const FILTERS: { id: IdeaStatus; label: string }[] = [
  { id: 'new', label: 'Novas' },
  { id: 'promoted', label: 'Viraram tarefa' },
  { id: 'archived', label: 'Arquivadas' },
];

@Component({
  selector: 'app-ideas-page',
  imports: [RouterLink, Icon, AgoPipe, ProjectSelect, ProjectAvatar],
  templateUrl: './ideas-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class IdeasPage {
  protected readonly ideas = inject(IdeasService);
  protected readonly projects = inject(ProjectsService);

  protected readonly filters = FILTERS;
  protected readonly status = signal<IdeaStatus>('new');
  protected readonly projectFilter = signal('');
  protected readonly query = signal('');
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly projectSlug = signal('');
  protected readonly importing = signal(false);
  protected readonly importResult = signal<string | null>(null);
  protected readonly sourceLabel = (s: string) => IDEA_SOURCE_LABEL[s] ?? s;

  protected readonly counts = computed(() => Object.fromEntries(FILTERS.map(f => [f.id, this.ideas.ideas().filter(i => i.status === f.id).length])));
  protected readonly list = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.ideas.ideas().filter(i =>
      i.status === this.status()
      && (!this.projectFilter() || (this.projectFilter() === '-' ? !i.projectSlug : i.projectSlug === this.projectFilter()))
      && (!q || i.title.toLowerCase().includes(q) || i.body?.toLowerCase().includes(q)));
  });

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected async capture(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.title().trim()) return;
    await this.ideas.create(this.title().trim(), this.body().trim(), this.projectSlug() || null);
    this.title.set('');
    this.body.set('');
    this.status.set('new');
  }

  protected promote(i: Idea): void {
    if (i.projectSlug) this.ideas.promote(i.id, i.projectSlug);
  }

  protected async importPending(): Promise<void> {
    this.importing.set(true);
    this.importResult.set(null);
    try {
      const r = await this.ideas.importPending();
      this.importResult.set(r.ideas || r.tasks
        ? `${r.ideas} ${r.ideas === 1 ? 'ideia nova' : 'ideias novas'} e ${r.tasks} ${r.tasks === 1 ? 'PR' : 'PRs'} na coluna Revisão. Fontes: ${r.sources.length}.`
        : 'Nada novo: tudo já estava importado.');
    } catch (e) {
      this.importResult.set(errorMessage(e));
    } finally {
      this.importing.set(false);
    }
  }
}
