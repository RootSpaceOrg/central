import { Injectable, inject, signal } from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { TerminalKind } from '../../../../shared/contract';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { TerminalsApiService } from './terminals-api.service';

export interface TerminalSession {
  /** id do processo no principal */
  pty: number;
  alive: boolean;
  term: Terminal;
  fit: FitAddon;
  /** elemento onde o xterm foi aberto; a tela só move ele de lugar */
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

/** Terminais das abas de sessão, por id da sessão. Trocar de tela não mata o processo. */
@Injectable({ providedIn: 'root' })
export class TerminalsService {
  private readonly api = inject(TerminalsApiService);
  /** saída que chegou antes do terminal ser registrado */
  private readonly early = new Map<number, string>();
  private readonly starting = new Set<number>();

  readonly terms = signal<ReadonlyMap<number, TerminalSession>>(new Map());
  readonly error = signal<string | null>(null);

  constructor() {
    this.api.onData(({ id, data }) => {
      const t = this.byPty(id);
      if (t) t.term.write(data);
      else this.early.set(id, (this.early.get(id) ?? '') + data);
    });
    this.api.onExit(({ id, code }) => {
      const entry = [...this.terms()].find(([, t]) => t.pty === id);
      if (!entry) return;
      entry[1].term.write(`\r\n\x1b[90m[processo encerrado, código ${code}]\x1b[0m\r\n`);
      this.set(entry[0], { ...entry[1], alive: false });
    });
  }

  /** Abre o processo da sessão (ou reabre, se ele terminou). */
  async start(sessionId: number, cwd: string, kind: TerminalKind): Promise<void> {
    if (this.starting.has(sessionId)) return;
    this.starting.add(sessionId);
    this.stop(sessionId);
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
      const pty = await this.api.create({ cwd, kind, cols: 100, rows: 28 });
      term.onData(d => this.api.write(pty, d));
      this.set(sessionId, { pty, alive: true, term, fit, el });
      term.write(this.early.get(pty) ?? '');
      this.early.delete(pty);
      this.error.set(null);
    } catch (e) {
      term.dispose();
      this.error.set(`Não abriu o terminal: ${errorMessage(e)}`);
    } finally {
      this.starting.delete(sessionId);
    }
  }

  stop(sessionId: number): void {
    const t = this.terms().get(sessionId);
    if (!t) return;
    if (t.alive) this.api.kill(t.pty);
    t.term.dispose();
    const m = new Map(this.terms());
    m.delete(sessionId);
    this.terms.set(m);
  }

  /** Ajusta o xterm ao tamanho da área e avisa o processo. */
  fit(t: TerminalSession): void {
    if (!t.el.isConnected || !t.el.clientWidth) return;
    t.fit.fit();
    if (t.alive) this.api.resize(t.pty, t.term.cols, t.term.rows);
  }

  private set(sessionId: number, t: TerminalSession): void { this.terms.set(new Map(this.terms()).set(sessionId, t)); }
  private byPty(id: number) { return [...this.terms().values()].find(t => t.pty === id); }
}
