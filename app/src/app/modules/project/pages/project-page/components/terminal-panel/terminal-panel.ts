import { Component, ElementRef, OnDestroy, computed, effect, inject, input, viewChild } from '@angular/core';

import { Icon } from '../../../../../../shared/ui/icon';
import { TerminalKind, TerminalsService } from '../../../../services/terminals/terminals.service';

/** Abas de terminal do projeto. O xterm de cada sessão é movido para cá; o processo continua vivo fora da tela. */
@Component({
  selector: 'app-terminal-panel',
  imports: [Icon],
  host: { class: 'flex min-h-0 flex-col bg-night' },
  template: `
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-edge px-2" role="tablist" aria-label="Terminais">
      @for (s of sessions(); track s.id) {
        <div class="group flex items-center gap-1.5 rounded-lg pl-2.5 pr-1 py-1 text-[12.5px]"
             [class]="s.id === current()?.id ? 'bg-raise text-text' : 'text-mute hover:text-text'">
          <button type="button" role="tab" [attr.aria-selected]="s.id === current()?.id" (click)="terminals.select(slug(), s.id)"
                  class="flex items-center gap-1.5">
            <app-icon [name]="s.kind === 'claude' ? 'spark' : 'terminal'" [size]="13" [class.text-frost]="s.kind === 'claude'" />
            <span [class.line-through]="!s.alive">{{ s.title }}</span>
          </button>
          <button type="button" (click)="terminals.close(s.id)" [attr.aria-label]="'Fechar ' + s.title"
                  class="grid size-5 place-items-center rounded opacity-0 hover:bg-edge group-hover:opacity-100">
            <app-icon name="close" [size]="11" />
          </button>
        </div>
      }
      <button type="button" class="btn btn-ghost btn-sm ml-1" (click)="open('shell')"><app-icon name="plus" [size]="13" />Terminal</button>
      <button type="button" class="btn btn-ghost btn-sm" (click)="open('claude')"><app-icon name="spark" [size]="13" />Claude Code</button>
      @if (terminals.error()) { <span role="alert" class="ml-2 truncate text-[12px] text-no">{{ terminals.error() }}</span> }
    </div>
    <div class="relative min-h-0 flex-1">
      <div #host class="absolute inset-0"></div>
      @if (!sessions().length) {
        <div class="absolute inset-0 grid place-items-center text-[13px] text-mute">
          Abra um terminal ou uma sessão do Claude Code na pasta do projeto.
        </div>
      }
    </div>`,
})
export class TerminalPanel implements OnDestroy {
  protected readonly terminals = inject(TerminalsService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');

  readonly slug = input.required<string>();
  readonly cwd = input.required<string>();

  protected readonly sessions = computed(() => this.terminals.of(this.slug()));
  protected readonly current = computed(() => { this.terminals.active(); return this.terminals.activeOf(this.slug()); });
  private readonly observer = new ResizeObserver(() => this.refit());

  constructor() {
    effect(() => {
      const host = this.host()?.nativeElement;
      const s = this.current();
      if (!host) return;
      host.replaceChildren(...(s ? [s.el] : []));
      if (s) requestAnimationFrame(() => { this.terminals.fit(s); s.term.focus(); });
    });
    effect(() => {
      const host = this.host()?.nativeElement;
      if (host) this.observer.observe(host);
    });
  }

  /** Chamado pelo pai quando o painel muda de tamanho ou volta a aparecer. */
  refit(): void {
    const s = this.current();
    if (s) this.terminals.fit(s);
  }

  open(kind: TerminalKind): void {
    this.terminals.open(this.slug(), this.cwd(), kind);
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
  }
}
