import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { Proposal, Verdict } from '../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { RUN_STATUS_LABEL } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { SettingsApiService } from '../../../../shared/services/settings/settings-api.service';
import { Task, TasksService } from '../../../../shared/services/tasks/tasks.service';
import { TurnsService } from '../../../../shared/services/turns/turns.service';
import { UsageService, untilReset } from '../../../../shared/services/usage/usage.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Heartbeat } from '../../../../shared/ui/heartbeat';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';

type Mode = 'pilot' | 'light';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, Icon, AgoPipe, Heartbeat, ProjectAvatar],
  templateUrl: './home-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class HomePage {
  protected readonly projects = inject(ProjectsService);
  protected readonly proposals = inject(ProposalsService);
  protected readonly tasks = inject(TasksService);
  protected readonly ideas = inject(IdeasService);
  protected readonly runs = inject(RunsService);
  protected readonly turns = inject(TurnsService);
  protected readonly usage = inject(UsageService);
  protected readonly dialogs = inject(DialogsService);
  protected readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  private readonly settings = inject(SettingsApiService);
  private readonly router = inject(Router);

  private readonly today = new Date().toISOString().slice(0, 10);
  protected readonly mode = signal<Mode | null>(null);
  protected readonly since = signal<Date>(new Date(Date.now() - 86_400_000));
  protected readonly note = signal('');
  protected readonly noteSaved = signal(false);
  protected readonly importing = signal(false);
  protected readonly importResult = signal<string | null>(null);
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly reset = untilReset;

  protected readonly greeting = (() => {
    const h = new Date().getHours();
    return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  })();
  protected readonly date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  /** o que os agentes terminaram desde a última vez que você abriu o Início */
  protected readonly finished = computed(() =>
    this.runs.runs().filter(r => r.finishedAt && r.finishedAt > this.since() && r.status !== 'killed'));
  protected readonly away = computed(() => {
    const f = this.finished();
    return {
      ok: f.filter(r => r.status === 'succeeded').length,
      failed: f.filter(r => r.status === 'failed').length,
      prs: f.filter(r => r.prUrl).length,
      session: f.reduce((n, r) => n + (r.sessionUsed ?? 0), 0),
    };
  });

  protected readonly decide3 = computed(() => this.proposals.inbox().slice(0, 3));
  protected readonly ready = computed(() => this.tasks.tasks().filter(t => t.column === 'todo').sort((a, b) => a.priority - b.priority).slice(0, 3));
  protected readonly inMotion = computed(() => this.tasks.tasks().filter(t => t.column === 'doing' || t.column === 'review').slice(0, 5));
  protected readonly revisit = computed(() => {
    const fresh = this.ideas.fresh();
    return fresh.length ? fresh[new Date().getDate() % fresh.length] : null;
  });
  protected readonly recent = computed(() => [...this.projects.living()]
    .sort((a, b) => (b.lastCommitAt?.getTime() ?? 0) - (a.lastCommitAt?.getTime() ?? 0)).slice(0, 4));

  /** recomendação pela cota do Claude */
  protected readonly advice = computed(() => {
    const s = this.usage.session();
    if (!s) return null;
    const left = 100 - s.percent;
    if (left >= 50) return { tone: 'text-yes', text: 'Sobra cota: bom momento para mandar tarefas para agentes.' };
    if (left >= 20) return { tone: 'text-later', text: 'Cota pela metade: prefira tarefas pequenas ou revise PRs.' };
    return { tone: 'text-no', text: `Sessão quase no fim. Reinicia em ${untilReset(s.resetsAt)}: hora de revisar e decidir.` };
  });

  constructor() {
    this.settings.get(`mode:${this.today}`).then(m => this.mode.set((m as Mode) ?? null));
    this.settings.get('home:lastSeen').then(v => {
      if (v) this.since.set(new Date(v));
      this.settings.set('home:lastSeen', new Date().toISOString());
    });
  }

  /** abre o painel lateral já com o agente */
  protected talk(agentId: number): void {
    this.chat.selectAgent(agentId);
    this.chat.open.set(true);
  }

  protected setMode(m: Mode): void {
    this.mode.set(m);
    this.settings.set(`mode:${this.today}`, m);
  }

  protected decide(p: Proposal, v: Verdict): void { this.proposals.decide(p, v); }

  protected toAgent(t: Task): void {
    this.dialogs.newRun({ projectSlug: t.projectSlug, repoPath: t.repoPath ?? undefined, taskId: t.id, prompt: [t.title, t.body].filter(Boolean).join('\n\n') });
  }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected openCode(slug: string): void { this.router.navigate(['/projetos', slug], { queryParams: { aba: 'codigo' } }); }

  protected async saveNote(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.note().trim()) return;
    await this.ideas.create(this.note().trim(), '', null);
    this.note.set('');
    this.noteSaved.set(true);
    setTimeout(() => this.noteSaved.set(false), 2500);
  }

  protected async importPending(): Promise<void> {
    this.importing.set(true);
    try {
      const r = await this.ideas.importPending();
      this.importResult.set(`${r.ideas} ideias e ${r.tasks} PRs em revisão importados.`);
    } catch (e) {
      this.importResult.set(errorMessage(e));
    } finally {
      this.importing.set(false);
    }
  }
}
