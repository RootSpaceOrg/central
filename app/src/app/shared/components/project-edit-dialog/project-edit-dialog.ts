import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { PROJECT_COLORS, ProjectIconKind, ProjectStatus, STATUS_LABEL } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { Icon } from '../../ui/icon';
import { PROJECT_ICONS, ProjectAvatar } from '../../ui/project-avatar';

const EMOJIS = ['🚀', '📚', '🎓', '🐾', '🏥', '💼', '🎨', '🛒', '📈', '🧠', '⚡', '🌱', '🏫', '🧩', '🎯', '🔧'];

@Component({
  selector: 'app-project-edit-dialog',
  imports: [Icon, ProjectAvatar],
  templateUrl: './project-edit-dialog.html',
})
export class ProjectEditDialog {
  protected readonly dialogs = inject(DialogsService);
  protected readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly project = computed(() => {
    const slug = this.dialogs.editProject();
    return slug ? this.projects.bySlug().get(slug) ?? null : null;
  });

  protected readonly colors = PROJECT_COLORS;
  protected readonly emojis = EMOJIS;
  protected readonly icons = Object.keys(PROJECT_ICONS);
  protected readonly statuses = Object.keys(STATUS_LABEL) as ProjectStatus[];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly kinds: { id: ProjectIconKind; label: string }[] = [
    { id: 'letter', label: 'Letra' }, { id: 'emoji', label: 'Emoji' }, { id: 'lucide', label: 'Ícone' }, { id: 'image', label: 'Imagem' },
  ];

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly status = signal<ProjectStatus>('active');
  protected readonly color = signal(PROJECT_COLORS[0]);
  protected readonly iconKind = signal<ProjectIconKind>('letter');
  protected readonly iconValue = signal<string | null>(null);
  protected readonly folder = signal('');
  protected readonly confirmDelete = signal(false);
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
        this.name.set(p.name); this.description.set(p.description ?? ''); this.status.set(p.status); this.color.set(p.color);
        this.iconKind.set(p.iconKind); this.iconValue.set(p.iconValue); this.folder.set(p.folder);
        this.confirmDelete.set(false); this.error.set(null); this.busy.set(false);
        el.showModal();
      }
      if (!p && el.open) el.close();
    });
  }

  protected close(): void { this.dialogs.editProject.set(null); }

  protected iconSvg(name: string) { return this.sanitizer.bypassSecurityTrustHtml(PROJECT_ICONS[name]); }

  protected setKind(kind: ProjectIconKind): void {
    if (kind === this.iconKind()) return;
    this.iconKind.set(kind);
    this.iconValue.set(kind === 'emoji' ? EMOJIS[0] : kind === 'lucide' ? 'rocket' : null);
    if (kind === 'image') this.pickImage();
  }

  protected async pickImage(): Promise<void> {
    try {
      const img = await this.projects.pickImage();
      if (img) { this.iconKind.set('image'); this.iconValue.set(img); }
      else if (!this.iconValue()) this.iconKind.set('letter');
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

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
