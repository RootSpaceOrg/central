import { Injectable, inject, signal } from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { TerminalKind } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { TerminalsApiService } from './terminals-api.service';

export interface TerminalSession {
  /** id do processo no principal */
  pty: number;
  kind: TerminalKind;
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
  /** por sessão: por que o terminal não abriu */
  readonly errors = signal<ReadonlyMap<number, string>>(new Map());

  constructor() {
    this.api.onData(({ id, data }) => {
      const t = this.byPty(id);
      if (t) t.term.write(data);
      if (t?.kind === 'claude') this.watchClaude(id, data);
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
  async start(sessionId: number, cwd: string, kind: TerminalKind, projectSlug: string | null = null): Promise<void> {
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
      const pty = await this.api.create({ cwd, kind, project_slug: projectSlug, cols: 100, rows: 28 });
      term.onData(d => this.api.write(pty, d));
      this.set(sessionId, { pty, kind, alive: true, term, fit, el });
      term.write(this.early.get(pty) ?? '');
      this.early.delete(pty);
      this.setError(sessionId, null);
    } catch (e) {
      term.dispose();
      this.setError(sessionId, `Não abriu o terminal: ${errorMessage(e)}`);
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

  /**
   * Um xterm só pode estar num lugar da tela. Cada painel que mostra a sessão (aba do projeto, painel da Grade)
   * pede a vez; o último que pediu mostra, e quando ele some o anterior volta a mostrar.
   */
  private readonly claims = signal<ReadonlyMap<number, readonly symbol[]>>(new Map());

  claim(sessionId: number, who: symbol): void {
    const list = (this.claims().get(sessionId) ?? []).filter(x => x !== who);
    this.claims.set(new Map(this.claims()).set(sessionId, [...list, who]));
  }

  release(sessionId: number, who: symbol): void {
    this.claims.set(new Map(this.claims()).set(sessionId, (this.claims().get(sessionId) ?? []).filter(x => x !== who)));
  }

  owner(sessionId: number): symbol | undefined { return this.claims().get(sessionId)?.at(-1); }

  /** Ajusta o xterm ao tamanho da área e avisa o processo. */
  fit(t: TerminalSession): void {
    if (!t.el.isConnected || !t.el.clientWidth) return;
    t.fit.fit();
    if (t.alive) this.api.resize(t.pty, t.term.cols, t.term.rows);
  }

  private setError(sessionId: number, text: string | null): void {
    const m = new Map(this.errors());
    if (text) m.set(sessionId, text); else m.delete(sessionId);
    this.errors.set(m);
  }

  /**
   * Claude Code no terminal trabalhando: a interface dele mostra "esc to interrupt" enquanto roda. Visto → trabalhando
   * (desde a primeira vez); sumiu por 3 s → parado. Mapa: sessão → desde quando (ms).
   */
  readonly busy = signal<ReadonlyMap<number, number>>(new Map());
  private readonly idle = new Map<number, ReturnType<typeof setTimeout>>();

  private watchClaude(pty: number, data: string): void {
    const entry = [...this.terms()].find(([, t]) => t.pty === pty);
    if (!entry) return;
    const [sessionId] = entry;
    // tira as sequências de cor/cursor do terminal antes de procurar o texto
    const text = data.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07/g, '');
    if (!/to interrupt/i.test(text)) return;
    if (!this.busy().has(sessionId)) this.busy.set(new Map(this.busy()).set(sessionId, Date.now()));
    clearTimeout(this.idle.get(sessionId));
    this.idle.set(sessionId, setTimeout(() => {
      const m = new Map(this.busy());
      m.delete(sessionId);
      this.busy.set(m);
    }, 3000));
  }

  private set(sessionId: number, t: TerminalSession): void { this.terms.set(new Map(this.terms()).set(sessionId, t)); }
  private byPty(id: number) { return [...this.terms().values()].find(t => t.pty === id); }
}
