import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AgentsService } from '../../services/agents/agents.service';
import { AgentSelect } from '../pickers/agent-select';
import { ProjectSelect } from '../pickers/project-select';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { Repo } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { RunPermission, RunSize, SIZES } from '../../services/runs/runs.model';
import { RunsService } from '../../services/runs/runs.service';
import { UsageService, untilReset } from '../../services/usage/usage.service';
import { ago } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';
import { Select, SelectOption } from '../../ui/select';

@Component({
  selector: 'app-run-dialog',
  imports: [Icon, AgentSelect, ProjectSelect, Select],
  templateUrl: './run-dialog.html',
})
export class RunDialog {
  private readonly dialogs = inject(DialogsService);
  protected readonly projects = inject(ProjectsService);
  protected readonly usage = inject(UsageService);
  private readonly runs = inject(RunsService);
  private readonly router = inject(Router);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly state = this.dialogs.run;
  protected readonly sizes = SIZES;
  protected readonly reset = untilReset;
  private readonly agents = inject(AgentsService);
  protected readonly agentId = signal('');
  protected readonly projectSlug = signal('');
  protected readonly repos = signal<Repo[]>([]);
  /** '' = projeto inteiro */
  protected readonly repoPath = signal('');
  protected readonly repoOptions = computed<SelectOption[]>(() => [{ value: '', label: 'Projeto inteiro (sem worktree)' },
    ...this.repos().map(r => ({ value: r.path, label: `Repositório ${r.name}${r.lastCommitAt ? ' · ' + ago(r.lastCommitAt) : ''}` }))]);
  protected readonly prompt = signal('');
  protected readonly size = signal<RunSize>('medium');
  protected readonly permission = signal<RunPermission>('edits');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly project = computed(() => this.projects.bySlug().get(this.projectSlug()) ?? null);
  protected readonly canSubmit = computed(() => (!!this.projectSlug() || !!this.agentId()) && !!this.prompt().trim() && !this.busy());
  protected readonly sizeHint = computed(() => SIZES.find(s => s.id === this.size())!.hint);
  protected readonly freedomHint = computed(() => {
    if (!this.projectSlug()) return this.permission() === 'full' ? 'Roda qualquer comando, a partir da pasta do agente.' : 'Lê, organiza a Central e escreve só na pasta do agente.';
    if (this.permission() === 'full') return this.repoPath() ? 'Roda qualquer comando na worktree, sem perguntar.' : 'Altera as pastas do projeto direto, sem worktree. Use com cuidado.';
    return this.repoPath() ? 'Edita arquivos e roda git, gh, npm e python. Termina em PR draft.' : 'Só lê e analisa. O resultado vai para o backlog, ideias e decisões.';
  });

  constructor() {
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) {
        this.prompt.set(s.prompt ?? '');
        this.error.set(null);
        this.busy.set(false);
        this.size.set('medium');
        this.agentId.set(s.agentId ? String(s.agentId) : '');
        const agentProject = s.agentId ? this.agents.byId().get(s.agentId)?.projectSlug : null;
        this.selectProject(s.projectSlug ?? agentProject ?? (s.agentId ? '' : this.projects.defaultSlug()), s.repoPath ?? '');
        el.showModal();
      }
      if (!s && el.open) el.close();
    });
  }

  protected close(): void { this.state.set(null); }

  /** escolher um agente com projeto já traz o projeto dele */
  protected selectAgent(id: string): void {
    this.agentId.set(id);
    const agent = id ? this.agents.byId().get(Number(id)) : null;
    if (agent?.projectSlug && agent.projectSlug !== this.projectSlug()) this.selectProject(agent.projectSlug);
  }

  protected async selectProject(slug: string, repoPath = ''): Promise<void> {
    this.projectSlug.set(slug);
    this.repos.set([]);
    this.repoPath.set(repoPath);
    if (!slug) return;
    const repos = await this.projects.repos(slug);
    if (this.projectSlug() !== slug) return;
    this.repos.set(repos);
    if (repoPath && !repos.some(r => r.path === repoPath)) this.repoPath.set('');
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const run = await this.runs.start({
        projectSlug: this.projectSlug() || null, agentId: Number(this.agentId()) || null, repoPath: this.repoPath() || null, prompt: this.prompt(),
        budgetUsd: SIZES.find(s => s.id === this.size())!.budget, permission: this.permission(),
        proposalId: this.state()?.proposalId ?? null, taskId: this.state()?.taskId ?? null,
      });
      this.close();
      this.router.navigate(['/execucoes'], { queryParams: { run: run.id } });
    } catch (err) {
      this.error.set((err as Error).message);
      this.busy.set(false);
    }
  }
}
