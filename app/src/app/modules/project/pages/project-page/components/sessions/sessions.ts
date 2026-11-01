import { Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';

import { ChatView } from '../../../../../../shared/components/chat-view/chat-view';
import { SessionKind, TerminalKind } from '../../../../../../shared/contract';
import { ChatService, ChatSession } from '../../../../../../shared/services/chat/chat.service';
import { ContextMenuService, MenuEntry } from '../../../../../../shared/services/context-menu/context-menu.service';
import { Icon, IconName } from '../../../../../../shared/ui/icon';
import { CODE_TAB, Session, SessionsService } from '../../../../services/sessions/sessions.service';
import { TerminalsService } from '../../../../services/terminals/terminals.service';
import { CodeWorkspace } from '../code-workspace/code-workspace';

const KINDS: { kind: SessionKind; label: string; icon: IconName; hint?: string }[] = [
  { kind: 'chat', label: 'Claude', icon: 'central', hint: 'conversa' },
  { kind: 'claude', label: 'Claude Code', icon: 'spark', hint: 'terminal' },
  { kind: 'shell', label: 'PowerShell', icon: 'terminal' },
  { kind: 'cmd', label: 'CMD', icon: 'terminal' },
  { kind: 'bash', label: 'Git Bash', icon: 'terminal' },
];
const ICON = Object.fromEntries(KINDS.map(k => [k.kind, k.icon])) as Record<SessionKind, IconName>;

/** Sessões do projeto, como no Orca: aba de código fixa + conversas com o Claude e terminais, salvas entre aberturas. */
@Component({
  selector: 'app-project-sessions',
  imports: [Icon, ChatView, CodeWorkspace],
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
            <app-icon [name]="icon[s.kind]" [size]="13" [class.text-frost]="s.kind === 'chat' || s.kind === 'claude'" />
            <span class="truncate" [class.text-faint]="dead(s)">{{ s.title }}</span>
            @if (s.chatId && chat.busy().has(s.chatId)) { <span class="pulse size-1.5 shrink-0 rounded-full bg-frost" aria-label="trabalhando"></span> }
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
      @if (sessions.error() || terminals.error(); as err) { <span role="alert" class="ml-2 truncate text-[12px] text-no">{{ err }}</span> }
    </div>

    <div class="relative min-h-0 flex-1">
      <app-code-workspace class="absolute inset-0" [hidden]="activeId() !== code" [slug]="slug()" [folder]="folder()" (askClaude)="open('claude')" />
      @if (active(); as s) {
        @if (s.kind === 'chat') {
          @if (activeChat(); as c) { <app-chat-view class="absolute inset-0" [session]="c" /> }
        } @else {
          <div class="absolute inset-0 bg-night p-2"><div #host class="h-full w-full"></div></div>
          @if (dead(s)) {
            <div class="absolute inset-x-0 bottom-6 flex justify-center">
              <button type="button" class="btn btn-sm" (click)="startTerminal(s)"><app-icon name="play" [size]="14" />Abrir de novo</button>
            </div>
          }
        }
      }
    </div>`,
})
export class ProjectSessions implements OnDestroy {
  protected readonly sessions = inject(SessionsService);
  protected readonly terminals = inject(TerminalsService);
  protected readonly chat = inject(ChatService);
  private readonly menu = inject(ContextMenuService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');

  readonly slug = input.required<string>();
  readonly folder = input.required<string>();

  protected readonly code = CODE_TAB;
  protected readonly icon = ICON;
  protected readonly list = computed(() => this.sessions.of(this.slug()));
  protected readonly activeId = computed(() => this.sessions.active()[this.slug()] ?? CODE_TAB);
  protected readonly active = computed(() => this.list().find(s => s.id === this.activeId()) ?? null);
  /** criada fora do template: abrir a conversa escreve em signals */
  protected readonly activeChat = signal<ChatSession | null>(null);
  private readonly observer = new ResizeObserver(() => this.refit());

  constructor() {
    effect(() => { const slug = this.slug(); untracked(() => this.sessions.load(slug)); });
    effect(() => {
      const s = this.active();
      this.activeChat.set(s?.kind === 'chat' ? untracked(() => this.sessions.chatOf(s)) : null);
    });
    // terminal da aba ativa: abre o processo na primeira vez (inclusive abas salvas de outra abertura do app) e move o xterm para cá
    effect(() => {
      const s = this.active();
      const host = this.host()?.nativeElement;
      if (!s || s.kind === 'chat' || !host) return;
      const t = this.terminals.terms().get(s.id);
      if (!t) { untracked(() => this.startTerminal(s)); return; }
      if (t.el.parentElement !== host) host.replaceChildren(t.el);
      this.observer.observe(host);
      requestAnimationFrame(() => { this.terminals.fit(t); t.term.focus(); });
    });
  }

  protected dead(s: Session): boolean { return s.kind !== 'chat' && this.terminals.terms().get(s.id)?.alive === false; }

  protected startTerminal(s: Session): void { this.terminals.start(s.id, this.folder(), s.kind as TerminalKind); }

  protected open(kind: SessionKind, chatId: number | null = null): void { this.sessions.open(this.slug(), kind, chatId); }

  protected plus(e: MouseEvent): void {
    const past = this.chat.projectChats(this.slug()).filter(c => !this.list().some(s => s.chatId === c.id)).slice(0, 8);
    const items: MenuEntry[] = KINDS.map(k => ({ label: k.label, icon: k.icon, hint: k.hint, run: () => this.open(k.kind) }));
    if (past.length) items.push(null, ...past.map(c => ({ label: c.title, icon: 'timer' as const, hint: 'retomar', run: () => this.open('chat', c.id) })));
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.open(new MouseEvent('click', { clientX: r.left, clientY: r.bottom + 4 }), items);
  }

  protected tabMenu(e: MouseEvent, s: Session): void {
    this.menu.open(e, [
      { label: 'Renomear', icon: 'edit', run: () => this.rename(s) },
      ...(s.kind !== 'chat' ? [{ label: 'Reiniciar terminal', icon: 'sync' as const, run: () => this.startTerminal(s) }] : []),
      null,
      { label: 'Fechar', icon: 'close', run: () => this.sessions.close(s) },
    ]);
  }

  protected rename(s: Session): void {
    const title = prompt('Nome da sessão', s.title);
    if (title?.trim()) this.sessions.rename(s, title);
  }

  private refit(): void {
    const s = this.active();
    const t = s ? this.terminals.terms().get(s.id) : null;
    if (t) this.terminals.fit(t);
  }

  ngOnDestroy(): void { this.observer.disconnect(); }
}
