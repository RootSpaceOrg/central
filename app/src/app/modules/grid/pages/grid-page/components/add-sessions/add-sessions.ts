import { Component, ElementRef, computed, effect, inject, model, signal, viewChild } from '@angular/core';

import { SessionKind } from '../../../../../../shared/contract';
import { DialogsService } from '../../../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { SESSION_IMG, SESSION_KINDS, SessionsService } from '../../../../../../shared/services/sessions/sessions.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';
import { GridsService } from '../../../../services/grids/grids.service';

interface Pending { key: number; slug: string; kind: SessionKind }

/**
 * Montar a grade de uma vez: marque sessões abertas de qualquer projeto e/ou peça sessões novas (vários terminais,
 * conversas…). Ao confirmar, elas ocupam os painéis vazios e depois dividem o maior painel.
 */
@Component({
  selector: 'app-add-sessions',
  imports: [Icon, ProjectAvatar],
  template: `
    <dialog #dlg (close)="open.set(false)" aria-labelledby="add-title"
            class="m-auto flex h-[min(720px,88vh)] w-[min(860px,94vw)] flex-col rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <header class="flex items-start gap-4 px-7 pt-6 pb-3">
        <div class="flex-1">
          <h2 id="add-title" class="font-display text-xl font-semibold">Adicionar sessões à grade</h2>
          <p class="mt-0.5 text-[13.5px] text-mute">Marque quantas quiser, de qualquer projeto. Novas sessões são criadas ao confirmar.</p>
        </div>
        <button type="button" class="btn btn-ghost !p-2" (click)="open.set(false)" aria-label="Fechar"><app-icon name="close" /></button>
      </header>
      <div class="px-7 pb-3">
        <input class="field w-full" placeholder="Filtrar projetos…" aria-label="Filtrar projetos" [value]="query()" (input)="query.set($any($event.target).value)" />
      </div>
      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-7 pb-4">
        @for (p of visible(); track p.slug) {
          <section class="rounded-2xl border border-edge bg-night/40 p-3" [class.opacity-50]="!p.folderExists">
            <div class="flex items-center gap-2">
              <app-project-avatar [project]="p" [size]="24" />
              <span class="font-semibold">{{ p.name }}</span>
              @if (!p.folderExists) { <span class="text-[12px] text-no">pasta não existe</span> }
              <span class="flex-1"></span>
              <button type="button" class="text-[12px] text-frost hover:underline" (click)="importFor(p.slug)">Importar do Claude Code…</button>
            </div>
            @if (sessions.of(p.slug).length) {
              <div class="mt-2 flex flex-wrap gap-1.5">
                @for (s of sessions.of(p.slug); track s.id) {
                  @let placed = grids.placed().has(s.id);
                  <button type="button" (click)="toggle(s.id)" [disabled]="placed" [attr.aria-pressed]="selected().has(s.id)"
                          class="flex max-w-64 items-center gap-1.5 rounded-lg border px-2 py-1 text-[12.5px] transition disabled:opacity-40"
                          [class]="selected().has(s.id) ? 'border-frost bg-frost/15 text-text' : 'border-edge text-mute hover:border-faint hover:text-text'"
                          [title]="placed ? 'Já está na grade' : s.title">
                    <span class="grid size-3.5 place-items-center rounded border" [class]="selected().has(s.id) ? 'border-frost bg-frost text-night' : 'border-faint'">
                      @if (selected().has(s.id)) { <app-icon name="check" [size]="10" /> }</span>
                    <img [src]="img[s.kind]" alt="" class="size-3.5" /><span class="truncate">{{ s.title }}</span>
                  </button>
                }
              </div>
            }
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <span class="text-[12px] text-faint">Nova:</span>
              @for (k of kinds; track k.kind) {
                <button type="button" (click)="addNew(p.slug, k.kind)" [disabled]="!p.folderExists"
                        class="flex items-center gap-1.5 rounded-lg border border-dashed border-edge px-2 py-1 text-[12.5px] text-mute transition hover:border-faint hover:text-text disabled:opacity-40">
                  <img [src]="k.img" alt="" class="size-3.5" />{{ k.label }}
                  @if (countNew(p.slug, k.kind); as n) { <span class="rounded-full bg-frost px-1.5 text-[11px] font-bold text-night">{{ n }}</span> }
                </button>
              }
            </div>
          </section>
        }
      </div>
      <footer class="flex items-center gap-3 border-t border-edge px-7 py-4">
        <span class="min-w-0 flex-1 truncate text-[13px] text-mute">
          @if (total()) { {{ selected().size }} aberta(s) + {{ pending().length }} nova(s) }
          @else { Nada marcado ainda. }
        </span>
        @if (pending().length) { <button type="button" class="btn btn-sm btn-ghost" (click)="pending.set([])">Limpar novas</button> }
        <button type="button" class="btn btn-primary" (click)="confirm()" [disabled]="!total() || busy()">
          <app-icon name="grid" [size]="16" />{{ busy() ? 'Abrindo…' : 'Adicionar ' + total() + ' à grade' }}</button>
      </footer>
    </dialog>`,
})
export class AddSessions {
  protected readonly grids = inject(GridsService);
  protected readonly sessions = inject(SessionsService);
  private readonly projects = inject(ProjectsService);
  private readonly dialogs = inject(DialogsService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly open = model(false);

  protected readonly kinds = SESSION_KINDS;
  protected readonly img = SESSION_IMG;
  protected readonly query = signal('');
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  protected readonly pending = signal<Pending[]>([]);
  protected readonly busy = signal(false);
  protected readonly total = computed(() => this.selected().size + this.pending().length);
  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.projects.living().filter(p => !q || p.name.toLowerCase().includes(q));
  });
  private seq = 0;

  constructor() {
    effect(() => {
      const open = this.open();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (open && !el.open) { this.selected.set(new Set()); this.pending.set([]); this.query.set(''); el.showModal(); }
      if (!open && el.open) el.close();
    });
  }

  protected toggle(id: number): void {
    this.selected.update(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  /** Cada clique pede mais uma (ex.: 3 × PowerShell). */
  protected addNew(slug: string, kind: SessionKind): void { this.pending.update(list => [...list, { key: this.seq++, slug, kind }]); }

  protected countNew(slug: string, kind: SessionKind): number { return this.pending().filter(p => p.slug === slug && p.kind === kind).length; }

  protected importFor(slug: string): void {
    this.open.set(false);
    this.dialogs.importSession.set({ slug, onDone: id => this.grids.add([id]) });
  }

  protected async confirm(): Promise<void> {
    this.busy.set(true);
    try {
      const created: number[] = [];
      for (const p of this.pending()) {
        const s = await this.sessions.open(p.slug, p.kind, null, false);
        if (s) created.push(s.id);
      }
      this.grids.add([...this.selected(), ...created]);
      this.open.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
