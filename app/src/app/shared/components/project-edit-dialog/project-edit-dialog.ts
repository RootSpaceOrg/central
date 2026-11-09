import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { PROJECT_COLORS, ProjectIconKind, ProjectStatus, STATUS_LABEL } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { Icon } from '../../ui/icon';
import { ProjectAvatar } from '../../ui/project-avatar';
import { IconPicker } from '../pickers/icon-picker';
import { ProjectSelect } from '../pickers/project-select';

@Component({
  selector: 'app-project-edit-dialog',
  imports: [Icon, ProjectAvatar, IconPicker, ProjectSelect],
  templateUrl: './project-edit-dialog.html',
})
export class ProjectEditDialog {
  protected readonly dialogs = inject(DialogsService);
  protected readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly project = computed(() => {
    const slug = this.dialogs.editProject();
    return slug ? this.projects.bySlug().get(slug) ?? null : null;
  });

  protected readonly statuses = Object.keys(STATUS_LABEL) as ProjectStatus[];
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly status = signal<ProjectStatus>('active');
  protected readonly doneWhen = signal<'merge' | 'prod'>('merge');
  protected readonly color = signal(PROJECT_COLORS[0]);
  protected readonly iconKind = signal<ProjectIconKind>('letter');
  protected readonly iconValue = signal<string | null>(null);
  protected readonly folder = signal('');
  protected readonly parentSlug = signal('');
  protected readonly childNames = computed(() => this.projects.children(this.project()?.slug ?? '').map(c => c.name).join(', '));
  protected readonly confirmDelete = signal(false);
  protected readonly tabs = [{ id: 'geral', label: 'Geral' }, { id: 'aparencia', label: 'Aparência' }, { id: 'pasta', label: 'Pasta' }] as const;
  protected readonly tab = signal<'geral' | 'aparencia' | 'pasta'>('geral');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** prévia ao vivo do ícone */
  protected readonly preview = computed(() => ({
    name: this.name() || '?', color: this.color(), iconKind: this.iconKind(), iconValue: this.iconValue(),
  }));

  constructor() {
    effect(() => {
      const p = this.project();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (p && !el.open) {
        this.name.set(p.name); this.description.set(p.description ?? ''); this.status.set(p.status); this.doneWhen.set(p.doneWhen); this.color.set(p.color);
        this.iconKind.set(p.iconKind); this.iconValue.set(p.iconValue); this.folder.set(p.folder); this.parentSlug.set(p.parentSlug ?? '');
        this.confirmDelete.set(false); this.error.set(null); this.busy.set(false); this.tab.set('geral');
        el.showModal();
      }
      if (!p && el.open) el.close();
    });
  }

  protected close(): void { this.dialogs.editProject.set(null); }

  protected async pickFolder(): Promise<void> {
    const f = await this.projects.pickFolder(this.folder());
    if (f) this.folder.set(f);
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const p = this.project();
    if (!p || !this.name().trim()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.projects.edit(p.slug, {
        name: this.name(), description: this.description().trim() || null, status: this.status(), color: this.color(),
        iconKind: this.iconKind(), iconValue: this.iconValue(), folder: this.folder() !== p.folder ? this.folder() : undefined,
        parentSlug: (this.parentSlug() || null) !== p.parentSlug ? this.parentSlug() || null : undefined, doneWhen: this.doneWhen(),
      });
      this.close();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.busy.set(true);
    try {
      await this.projects.remove(p.slug);
      this.close();
      this.router.navigate(['/']);
    } catch (err) {
      this.error.set((err as Error).message);
      this.busy.set(false);
    }
  }
}
