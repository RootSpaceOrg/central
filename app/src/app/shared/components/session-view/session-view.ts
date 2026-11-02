import { Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';

import { TerminalKind } from '../../contract';
import { ChatSession } from '../../services/chat/chat.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { Session, SessionsService } from '../../services/sessions/sessions.service';
import { TerminalsService } from '../../services/terminals/terminals.service';
import { Icon } from '../../ui/icon';
import { ChatView } from '../chat-view/chat-view';

/** Uma sessão na tela: conversa com o Claude ou terminal. Usada nas abas do projeto e nos painéis da Grade. */
@Component({
  selector: 'app-session-view',
  imports: [ChatView, Icon],
  // quem usa posiciona (absolute inset-0): os filhos absolutos se apoiam no host
  host: { class: 'block min-h-0' },
  template: `
    @if (session().kind === 'chat') {
      @if (chat(); as c) { <app-chat-view class="absolute inset-0" [session]="c" [compact]="compact()" /> }
    } @else {
      <div class="absolute inset-0 bg-night p-2" (mousedown)="claim()"><div #host class="h-full w-full"></div></div>
      @if (!mine()) {
        <div class="absolute inset-0 grid place-items-center bg-night">
          <button type="button" class="btn btn-sm" (click)="claim()"><app-icon name="terminal" [size]="14" />Aberto em outro painel: mostrar aqui</button>
        </div>
      } @else if (!started() && terminals.errors().get(session().id); as err) {
        <p role="alert" class="absolute inset-x-6 top-6 rounded-xl bg-no/10 px-3 py-2 text-[13px] text-no">{{ err }}</p>
      } @else if (dead()) {
        <div class="absolute inset-x-0 bottom-6 flex justify-center">
          <button type="button" class="btn btn-sm" (click)="restart()"><app-icon name="play" [size]="14" />Abrir de novo</button>
        </div>
      }
    }`,
})
export class SessionView implements OnDestroy {
  private readonly sessions = inject(SessionsService);
  protected readonly terminals = inject(TerminalsService);
  private readonly projects = inject(ProjectsService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private readonly me = Symbol('session-view');
  private claimed: number | null = null;

  readonly session = input.required<Session>();
  /** painel pequeno (Grade): conversa com menos respiro */
  readonly compact = input(false);

  /** criada fora do template: abrir a conversa escreve em signals */
  protected readonly chat = signal<ChatSession | null>(null);
  protected readonly mine = computed(() => this.terminals.owner(this.session().id) === this.me);
  protected readonly started = computed(() => this.terminals.terms().has(this.session().id));
  protected readonly dead = computed(() => this.terminals.terms().get(this.session().id)?.alive === false);
  private readonly observer = new ResizeObserver(() => this.refit());

  constructor() {
    effect(() => {
      const s = this.session();
      untracked(() => {
        this.chat.set(s.kind === 'chat' ? this.sessions.chatOf(s) : null);
        if (s.kind !== 'chat' && this.claimed !== s.id) {
          if (this.claimed !== null) this.terminals.release(this.claimed, this.me);
          this.claimed = s.id;
          this.terminals.claim(s.id, this.me);
        }
      });
    });
    // abre o processo na primeira vez (inclusive sessões salvas de outra abertura do app) e traz o xterm para cá
    effect(() => {
      const s = this.session();
      const host = this.host()?.nativeElement;
      if (s.kind === 'chat' || !host || !this.mine()) return;
      this.projects.bySlug(); // a pasta do projeto pode chegar depois
      const t = this.terminals.terms().get(s.id);
      if (!t) { untracked(() => this.restart()); return; }
      if (t.el.parentElement !== host) host.replaceChildren(t.el);
      this.observer.observe(host);
      requestAnimationFrame(() => this.terminals.fit(t));
    });
  }

  protected claim(): void {
    if (this.session().kind === 'chat' || this.mine()) return;
    this.terminals.claim(this.session().id, this.me);
  }

  restart(): void {
    const s = this.session();
    const folder = this.projects.bySlug().get(s.projectSlug)?.folder;
    if (folder) this.terminals.start(s.id, folder, s.kind as TerminalKind);
  }

  focus(): void { this.terminals.terms().get(this.session().id)?.term.focus(); }

  private refit(): void {
    const t = this.terminals.terms().get(this.session().id);
    if (t && this.mine()) this.terminals.fit(t);
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
    if (this.claimed !== null) this.terminals.release(this.claimed, this.me);
  }
}
