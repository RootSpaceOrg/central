import { Component, computed, inject, signal } from '@angular/core';

import { RouterLink } from '@angular/router';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

import { IDEA_SOURCE_LABEL, IDEA_STATUS, Idea, IdeaStatus, IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../shared/ui/markdown';
import { SettingsApiService } from '../../../../shared/services/settings/settings-api.service';

/** Texto livre → ideia: a primeira linha (sem o "#") é o título; o resto é a descrição em markdown. */
export function parseDraft(text: string): { title: string; body: string } {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const first = lines[0].replace(/^\s*(#+|[-*>])\s*/, '').trim();
  if (first.length <= 120) return { title: first, body: lines.slice(1).join('\n').trim() };
  // parágrafo longo sem título: corta numa palavra e guarda o texto inteiro
  return { title: `${first.slice(0, 100).replace(/\s+\S*$/, '')}…`, body: text.trim() };
}


@Component({
  selector: 'app-ideas-page',
  imports: [RouterLink, Icon, AgoPipe, ProjectSelect, ProjectAvatar, MarkdownPipe],
  templateUrl: './ideas-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class IdeasPage {
  protected readonly ideas = inject(IdeasService);
  protected readonly projects = inject(ProjectsService);

  protected readonly filters = IDEA_STATUS;
  protected readonly status = signal<IdeaStatus>('approved');
  protected readonly hint = computed(() => IDEA_STATUS.find(f => f.id === this.status())!.hint);
  protected readonly error = signal<string | null>(null);
  protected readonly projectFilter = signal('');
  protected readonly query = signal('');
  /** caixa de anotar */
  protected readonly draft = signal('');
  protected readonly parsed = computed(() => parseDraft(this.draft()));
  protected readonly preview = signal(false);
  protected readonly dragging = signal(false);
  /** o agente de triagem lê o que você anota (configurado na Triagem) */
  protected readonly triageOn = signal(true);
  protected readonly projectSlug = signal('');
  protected readonly importing = signal(false);
  protected readonly importResult = signal<string | null>(null);
  protected readonly sourceLabel = (s: string) => IDEA_SOURCE_LABEL[s] ?? s;

  protected readonly counts = computed(() => Object.fromEntries(IDEA_STATUS.map(f => [f.id, this.ideas.ideas().filter(i => i.status === f.id).length])) as Record<IdeaStatus, number>);
  protected readonly list = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.ideas.ideas().filter(i =>
      i.status === this.status()
      && (!this.projectFilter() || (this.projectFilter() === '-' ? !i.projectSlug : i.projectSlug === this.projectFilter()))
      && (!q || i.title.toLowerCase().includes(q) || i.body?.toLowerCase().includes(q)));
  });

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  constructor() {
    inject(SettingsApiService).get('triage:mode').then(v => this.triageOn.set(v !== 'off'));
  }

  protected async capture(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.draft().trim()) return;
    const { title, body } = this.parsed();
    try {
      await this.ideas.create(title, body, this.projectSlug() || null);
      this.draft.set('');
      this.preview.set(false);
      this.status.set('new');
      this.error.set(null);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  /** .md/.txt: o conteúdo vai para a caixa (dá para revisar antes de anotar) */
  protected async load(file: File | undefined): Promise<void> {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name) && !file.type.startsWith('text/')) { this.error.set('Só arquivos .md ou .txt.'); return; }
    const text = (await file.text()).trim();
    // arquivo sem título em markdown: o nome do arquivo vira o título
    this.draft.set(/^\s*#/.test(text) ? text : `${file.name.replace(/\.\w+$/, '')}\n\n${text}`);
    this.preview.set(true);
    this.error.set(null);
  }
  protected onFile(e: Event): void { const input = e.target as HTMLInputElement; this.load(input.files?.[0]); input.value = ''; }
  protected onDrop(e: DragEvent): void {
    this.dragging.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return; // texto arrastado: o textarea cuida
    e.preventDefault();
    this.load(file);
  }

  protected promote(i: Idea): void {
    if (i.projectSlug) this.ideas.promote(i.id, i.projectSlug);
  }

  protected async approve(i: Idea): Promise<void> {
    try { await this.ideas.approve(i.id); this.error.set(null); }
    catch (e) { this.error.set((e as Error).message); }
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
