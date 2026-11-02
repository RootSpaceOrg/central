import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { errorMessage } from '../../services/ipc/ipc.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { ClaudeSession, SessionsService } from '../../services/sessions/sessions.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';

const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase();

/** Importar uma sessão do Claude Code (terminal, Orca, VS Code) para um projeto da Central. */
@Component({
  selector: 'app-import-session-dialog',
  imports: [Icon, AgoPipe],
  template: `
    <dialog #dlg (close)="dialogs.importSession.set(null)" aria-labelledby="imp-title"
            class="m-auto open:flex h-[min(680px,86vh)] w-[min(760px,94vw)] flex-col rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <header class="flex items-start gap-4 px-7 pt-6 pb-3">
        <img src="file-icons/claude.svg" alt="" class="mt-1 size-7" />
        <div class="flex-1">
          <h2 id="imp-title" class="font-display text-xl font-semibold">Importar sessão do Claude Code</h2>
          <p class="mt-0.5 text-[13.5px] text-mute">Para {{ project()?.name }}. O histórico vem junto e a conversa continua de onde parou, agora conhecendo a Central.</p>
        </div>
        <button type="button" class="btn btn-ghost !p-2" (click)="dialogs.importSession.set(null)" aria-label="Fechar"><app-icon name="close" /></button>
      </header>
      <div class="flex items-center gap-3 px-7 pb-3">
        <input class="field flex-1" placeholder="Buscar pelo título ou pela pasta…" aria-label="Buscar" [value]="query()" (input)="query.set($any($event.target).value)" />
        <label class="flex shrink-0 items-center gap-2 text-[13px] text-mute">
          <input type="checkbox" [checked]="onlyHere()" (change)="onlyHere.set($any($event.target).checked)" />Só da pasta do projeto
        </label>
      </div>
      <ul class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        @if (loading()) { <li class="px-3 py-6 text-center text-mute">Lendo as sessões…</li> }
        @for (s of visible(); track s.id) {
          <li>
            <button type="button" (click)="pick(s)" [disabled]="busy()"
                    class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-raise disabled:opacity-50">
              <img src="file-icons/claude.svg" alt="" class="size-4 shrink-0" />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ s.title }}</span>
                <span class="block truncate font-mono text-[11.5px] text-faint">{{ s.cwd }}</span>
              </span>
              @if (s.imported) { <span class="shrink-0 rounded-full bg-yes/15 px-2 py-0.5 text-[11.5px] text-yes">já na Central</span> }
              <span class="shrink-0 text-right text-[12px] text-faint">{{ s.updatedAt | ago }}<br />{{ s.sizeKb }} KB</span>
            </button>
          </li>
        } @empty {
          @if (!loading()) {
            <li class="px-3 py-8 text-center text-mute">
              Nenhuma sessão{{ onlyHere() ? ' nesta pasta' : '' }}.
              @if (onlyHere()) { <button type="button" class="ml-1 text-frost hover:underline" (click)="onlyHere.set(false)">Ver de todas as pastas</button> }
            </li>
          }
        }
      </ul>
      @if (error()) { <p role="alert" class="border-t border-edge px-7 py-3 text-[13px] text-no">{{ error() }}</p> }
    </dialog>`,
})
export class ImportSessionDialog {
  protected readonly dialogs = inject(DialogsService);
  private readonly sessions = inject(SessionsService);
  private readonly projects = inject(ProjectsService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly list = signal<ClaudeSession[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly onlyHere = signal(true);

  protected readonly project = computed(() => {
    const slug = this.dialogs.importSession()?.slug;
    return slug ? this.projects.bySlug().get(slug) ?? null : null;
  });
  protected readonly visible = computed(() => {
    const folder = norm(this.project()?.folder ?? '');
    const q = this.query().trim().toLowerCase();
    return this.list()
      .filter(s => !this.onlyHere() || norm(s.cwd).startsWith(folder))
      .filter(s => !q || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q))
      .slice(0, 150);
  });

  constructor() {
    effect(() => {
      const open = !!this.dialogs.importSession();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (open && !el.open) { this.load(); el.showModal(); }
      if (!open && el.open) el.close();
    });
  }

  private async load(): Promise<void> {
    this.error.set(null);
    this.query.set('');
    this.onlyHere.set(true);
    this.loading.set(true);
    try { this.list.set(await this.sessions.claudeSessions()); }
    catch (e) { this.error.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }

  protected async pick(s: ClaudeSession): Promise<void> {
    const state = this.dialogs.importSession();
    if (!state) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const created = await this.sessions.importClaude(s.id, state.slug);
      state.onDone?.(created.id);
      this.dialogs.importSession.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
