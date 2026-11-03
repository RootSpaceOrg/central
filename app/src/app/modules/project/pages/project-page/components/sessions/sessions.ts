import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { DialogsService } from '../../../../../../shared/services/dialogs/dialogs.service';

import { SessionView } from '../../../../../../shared/components/session-view/session-view';
import { SessionKind } from '../../../../../../shared/contract';
import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { LiveService } from '../../../../../../shared/services/live/live.service';
import { ContextMenuService, MenuEntry } from '../../../../../../shared/services/context-menu/context-menu.service';
import { CODE_TAB, SESSION_IMG, SESSION_KINDS, Session, SessionsService } from '../../../../../../shared/services/sessions/sessions.service';
import { TerminalsService } from '../../../../../../shared/services/terminals/terminals.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { CodeWorkspace } from '../code-workspace/code-workspace';

import { AskService } from '../../../../../../shared/services/ask/ask.service';
/** Sessões do projeto, como no Orca: aba de código fixa + conversas com o Claude e terminais, salvas entre aberturas. */
@Component({
  selector: 'app-project-sessions',
  imports: [Icon, SessionView, CodeWorkspace],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    <div class="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-edge bg-panel px-2" role="tablist" aria-label="Sessões">
      <button type="button" role="tab" [attr.aria-selected]="activeId() === code" (click)="sessions.select(slug(), code)"
              class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-medium"
              [class]="activeId() === code ? 'bg-raise text-text' : 'text-mute hover:bg-raise/60 hover:text-text'">
        <app-icon name="code" [size]="13" />Código
      </button>
      @for (s of list(); track s.id) {
        <div class="group flex max-w-56 shrink-0 items-center gap-1 rounded-lg pr-1 pl-2.5 py-1 text-[12.5px] font-medium"
             [class]="s.id === activeId() ? 'bg-raise text-text' : 'text-mute hover:bg-raise/60 hover:text-text'"
             (contextmenu)="tabMenu($event, s)" (auxclick)="$event.button === 1 && sessions.close(s)">
          <button type="button" role="tab" [attr.aria-selected]="s.id === activeId()" (click)="sessions.select(slug(), s.id)"
                  (dblclick)="rename(s)" class="flex min-w-0 items-center gap-1.5" [title]="s.title">
            <img [src]="img[s.kind]" alt="" class="size-3.5 shrink-0" />
            <span class="truncate" [class.text-faint]="dead(s)">{{ s.title }}</span>
            @if (working(s); as w) {
              <span class="flex shrink-0 items-center gap-1 rounded-full bg-frost/15 px-1.5 text-[11px] tabular-nums text-frost" [title]="w.title">
                <span class="pulse size-1.5 rounded-full bg-frost"></span>{{ w.time }}@if (w.subs) { <span class="text-[#C6A6FF]">· {{ w.subs }} sub</span> }</span>
            }
          </button>
          <button type="button" (click)="sessions.close(s)" [attr.aria-label]="'Fechar ' + s.title"
                  class="grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-edge group-hover:opacity-100 focus:opacity-100">
            <app-icon name="close" [size]="11" />
          </button>
        </div>
      }
      <button type="button" class="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-[12.5px] text-mute hover:bg-raise hover:text-text"
              (click)="plus($event)" title="Nova sessão: Claude, Claude Code ou terminal" aria-label="Nova sessão">
        <app-icon name="plus" [size]="15" />@if (!list().length) { <span>Nova sessão</span> }</button>
      @if (sessions.error(); as err) { <span role="alert" class="ml-2 truncate text-[12px] text-no">{{ err }}</span> }
    </div>

    <div class="relative min-h-0 flex-1">
      <app-code-workspace class="absolute inset-0" [hidden]="activeId() !== code" [slug]="slug()" [folder]="folder()" (askClaude)="open('claude')" />
      @if (active(); as s) { <app-session-view class="absolute inset-0" [session]="s" /> }
    </div>`,
})
export class ProjectSessions {
  private readonly ask = inject(AskService);
  protected readonly sessions = inject(SessionsService);
  protected readonly terminals = inject(TerminalsService);
  protected readonly chat = inject(ChatService);
  protected readonly live = inject(LiveService);
  private readonly menu = inject(ContextMenuService);
  private readonly router = inject(Router);
  private readonly dialogs = inject(DialogsService);

  readonly slug = input.required<string>();
  readonly folder = input.required<string>();

  protected readonly code = CODE_TAB;
  protected readonly img = SESSION_IMG;
  protected readonly list = computed(() => this.sessions.of(this.slug()));
  /** sem escolha ainda: a última sessão aberta, ou o código */
  protected readonly activeId = computed(() => this.sessions.active()[this.slug()] ?? this.list().at(-1)?.id ?? CODE_TAB);
  protected readonly active = computed(() => this.list().find(s => s.id === this.activeId()) ?? null);

  /** trabalhando agora: há quanto tempo e quantos subagentes (conversa) ou Claude Code no terminal */
  protected working(s: Session): { time: string; subs: number; title: string } | null {
    const a = this.live.chat(s.chatId);
    if (a) {
      const subs = this.live.running(a);
      return { time: this.live.since(a.startedAt), subs, title: `${a.step ?? 'Trabalhando'}${subs ? ` · ${subs} subagente(s)` : ''}` };
    }
    const t = s.kind === 'claude' ? this.terminals.busy().get(s.id) : undefined;
    return t ? { time: this.live.since(t), subs: 0, title: 'Claude Code trabalhando' } : null;
  }

  protected dead(s: Session): boolean { return s.kind !== 'chat' && this.terminals.terms().get(s.id)?.alive === false; }

  protected open(kind: SessionKind, chatId: number | null = null): void { this.sessions.open(this.slug(), kind, chatId); }

  protected plus(e: MouseEvent): void {
    const past = this.chat.projectChats(this.slug()).filter(c => !this.list().some(s => s.chatId === c.id)).slice(0, 8);
    const items: MenuEntry[] = SESSION_KINDS.map(k => ({ label: k.label, img: k.img, hint: k.hint, run: () => this.open(k.kind) }));
    if (past.length) items.push(null, ...past.map(c => ({ label: c.title, icon: 'timer' as const, hint: 'retomar', run: () => this.open('chat', c.id) })));
    items.push(null, { label: 'Importar sessão do Claude Code…', img: 'file-icons/claude.svg', hint: 'Orca, terminal', run: () => this.dialogs.importSession.set({ slug: this.slug() }) });
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.open(new MouseEvent('click', { clientX: r.left, clientY: r.bottom + 4 }), items);
  }

  protected tabMenu(e: MouseEvent, s: Session): void {
    this.menu.open(e, [
      { label: 'Renomear', icon: 'edit', run: () => this.rename(s) },
      { label: 'Levar para a Grade', icon: 'grid', run: () => this.router.navigate(['/grade'], { queryParams: { sessao: s.id } }) },
      ...(s.kind !== 'chat' ? [{ label: 'Reiniciar terminal', icon: 'sync' as const, run: () => this.terminals.start(s.id, this.folder(), s.kind as never, s.projectSlug) }] : []),
      null,
      { label: 'Fechar', icon: 'close', run: () => this.sessions.close(s) },
    ]);
  }

  protected async rename(s: Session): Promise<void> {
    const title = await this.ask.text('Nome da sessão', s.title);
    if (title?.trim()) this.sessions.rename(s, title);
  }
}
