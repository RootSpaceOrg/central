import { Injectable, inject, signal } from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { TerminalsApiService } from './terminals-api.service';

export type TerminalKind = 'shell' | 'claude';

export interface TerminalSession {
  id: number;
  slug: string;
  kind: TerminalKind;
  title: string;
  alive: boolean;
  term: Terminal;
  fit: FitAddon;
  /** elemento onde o xterm foi aberto; o painel só move ele de lugar */
  el: HTMLDivElement;
}

const THEME = {
  background: '#141922', foreground: '#E6E9EF', cursor: '#7FA2FF', cursorAccent: '#141922',
  selectionBackground: '#7FA2FF55',
  black: '#1A202B', brightBlack: '#5D6679', red: '#F07167', brightRed: '#F58C84',
  green: '#3FBF8A', brightGreen: '#62D4A3', yellow: '#E0B44C', brightYellow: '#EBC670',
  blue: '#7FA2FF', brightBlue: '#9DB8FF', magenta: '#B48CFF', brightMagenta: '#C6A6FF',
  cyan: '#4CC9F0', brightCyan: '#74D6F4', white: '#C9CED8', brightWhite: '#FFFFFF',
};

/** Terminais vivem aqui, não no componente: trocar de tela não mata o processo. */
@Injectable({ providedIn: 'root' })
export class TerminalsService {
  private readonly api = inject(TerminalsApiService);
  /** saída que chegou antes da sessão ser registrada */
  private readonly early = new Map<number, string>();

  readonly sessions = signal<TerminalSession[]>([]);
  readonly active = signal<Record<string, number | null>>({});
  readonly error = signal<string | null>(null);

  constructor() {
    this.api.onData(({ id, data }) => {
      const s = this.find(id);
      if (s) s.term.write(data);
      else this.early.set(id, (this.early.get(id) ?? '') + data);
    });
    this.api.onExit(({ id, code }) => {
      const s = this.find(id);
      if (!s) return;
      s.term.write(`\r\n\x1b[90m[processo encerrado, código ${code}]\x1b[0m\r\n`);
      this.sessions.update(list => list.map(x => (x.id === id ? { ...x, alive: false } : x)));
    });
  }

  of(slug: string): TerminalSession[] { return this.sessions().filter(s => s.slug === slug); }
  activeOf(slug: string): TerminalSession | null {
    const id = this.active()[slug];
    return this.of(slug).find(s => s.id === id) ?? this.of(slug).at(-1) ?? null;
  }

  async open(slug: string, cwd: string, kind: TerminalKind): Promise<void> {
    const el = document.createElement('div');
    el.className = 'h-full w-full';
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace', fontSize: 13, lineHeight: 1.25,
      cursorBlink: true, theme: THEME, scrollback: 5000, allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      const id = await this.api.create({ cwd, kind, cols: 100, rows: 28 });
      term.onData(d => this.api.write(id, d));
      const n = this.of(slug).filter(s => s.kind === kind).length + 1;
      const title = kind === 'claude' ? `Claude Code${n > 1 ? ` ${n}` : ''}` : `Terminal${n > 1 ? ` ${n}` : ''}`;
      this.sessions.update(list => [...list, { id, slug, kind, title, alive: true, term, fit, el }]);
      term.write(this.early.get(id) ?? '');
      this.early.delete(id);
      this.active.update(a => ({ ...a, [slug]: id }));
      this.error.set(null);
    } catch (e) {
      term.dispose();
      this.error.set(`Não abriu o terminal: ${errorMessage(e)}`);
    }
  }

  select(slug: string, id: number): void { this.active.update(a => ({ ...a, [slug]: id })); }

  close(id: number): void {
    const s = this.find(id);
    if (!s) return;
    if (s.alive) this.api.kill(id);
    s.term.dispose();
    this.sessions.update(list => list.filter(x => x.id !== id));
  }

  /** Ajusta o xterm ao tamanho do painel e avisa o processo. */
  fit(s: TerminalSession): void {
    if (!s.el.isConnected || !s.el.clientWidth) return;
    s.fit.fit();
    if (s.alive) this.api.resize(s.id, s.term.cols, s.term.rows);
  }

  private find(id: number) { return this.sessions().find(s => s.id === id); }
}
