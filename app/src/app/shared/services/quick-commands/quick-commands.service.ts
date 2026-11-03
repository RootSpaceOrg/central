import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { TerminalKind } from '../../contract';
import { AgentsService } from '../agents/agents.service';
import { ChatService } from '../chat/chat.service';
import { errorMessage } from '../ipc/ipc.service';
import { ProjectsService } from '../projects/projects.service';
import { SessionsService } from '../sessions/sessions.service';
import { SettingsApiService } from '../settings/settings-api.service';
import { TerminalsService } from '../terminals/terminals.service';

/** Um comando salvo no topo do app (como no Orca): roda num terminal ou vira mensagem para um agente. */
export interface QuickCommand {
  id: string;
  label: string;
  action: 'terminal' | 'agent';
  command: string;
  /** terminal: aperta Enter no fim (roda na hora) */
  enter: boolean;
  /** projeto onde abre o terminal; null = o projeto aberto (ou o primeiro) */
  project: string | null;
  shell: Exclude<TerminalKind, 'claude'>;
  /** agente que recebe; null = Central */
  agentId: number | null;
}

const KEY = 'quick:commands';

/** Comandos rápidos: salvos nas configurações da Central; rodar abre a sessão e digita, ou manda para o agente. */
@Injectable({ providedIn: 'root' })
export class QuickCommandsService {
  private readonly settings = inject(SettingsApiService);
  private readonly sessions = inject(SessionsService);
  private readonly terminals = inject(TerminalsService);
  private readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);

  readonly commands = signal<QuickCommand[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    this.settings.get(KEY).then(v => { if (v) this.commands.set(JSON.parse(v) as QuickCommand[]); }).catch(() => {});
  }

  save(c: QuickCommand): void {
    const list = this.commands();
    this.persist(list.some(x => x.id === c.id) ? list.map(x => (x.id === c.id ? c : x)) : [...list, c]);
  }

  remove(id: string): void { this.persist(this.commands().filter(c => c.id !== id)); }

  private persist(list: QuickCommand[]): void {
    this.commands.set(list);
    this.settings.set(KEY, JSON.stringify(list)).catch(e => this.error.set(errorMessage(e)));
  }

  /** Projeto aberto na tela (rota /projetos/:slug), senão o primeiro vivo. */
  private currentProject(): string | null {
    const m = /\/projetos\/([^/?#]+)/.exec(this.router.url);
    return m?.[1] ?? this.projects.living()[0]?.slug ?? null;
  }

  async run(c: QuickCommand): Promise<void> {
    this.error.set(null);
    try {
      if (c.action === 'agent') {
        const agentId = c.agentId ?? this.agents.central()?.id;
        if (!agentId) throw new Error('Nenhum agente para receber.');
        this.chat.openInPanel(await this.chat.startBackground(agentId, c.command));
        return;
      }
      await this.inTerminal(c.command, c.project, c.shell, c.enter);
    } catch (e) {
      this.error.set(`${c.label}: ${(e as Error).message}`);
    }
  }

  /** Abre uma sessão de terminal no projeto e digita o comando (Enter = roda). */
  async inTerminal(command: string, project: string | null, shell: QuickCommand['shell'] = 'shell', enter = true): Promise<void> {
    const slug = project && this.projects.bySlug().has(project) ? project : this.currentProject();
    if (!slug) throw new Error('Adicione um projeto primeiro: o terminal abre na pasta dele.');
    const s = await this.sessions.open(slug, shell);
    if (!s) throw new Error(this.sessions.error() ?? 'Não abriu a sessão.');
    await this.router.navigate(['/projetos', slug], { queryParams: { aba: 'sessoes' } });
    await this.terminals.send(s.id, command + (enter ? '\r' : ''));
  }
}
