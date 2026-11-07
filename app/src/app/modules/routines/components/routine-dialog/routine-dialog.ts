import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

import { Repo } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RunPermission, RunSize, SIZES } from '../../../../shared/services/runs/runs.model';
import { Icon } from '../../../../shared/ui/icon';
import { Select, SelectOption } from '../../../../shared/ui/select';
import { AgentSelect } from '../../../../shared/components/pickers/agent-select';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { IS_WIN } from '../../../../shared/services/ipc/ipc.service';
import { Routine, RoutineDraft, RoutinesService, describeSchedule } from '../../../../shared/services/routines/routines.service';

/** Estado de abertura: null fechado; routine null = nova; draft = modelo pronto para começar. */
export type RoutineDialogState = { routine: Routine | null; draft?: Partial<RoutineDraft> } | null;

@Component({
  selector: 'app-routine-dialog',
  imports: [Icon, AgentSelect, ProjectSelect, Select],
  templateUrl: './routine-dialog.html',
})
export class RoutineDialog {
  protected readonly projects = inject(ProjectsService);
  private readonly routines = inject(RoutinesService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly state = input<RoutineDialogState>(null);
  readonly closed = output<void>();

  protected readonly sizes = SIZES;
  protected readonly weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  protected readonly name = signal('');
  /** agent = um agente (Claude) faz; command = roda um comando no terminal, sem Claude e sem cota */
  protected readonly kind = signal<'agent' | 'command'>('agent');
  protected readonly shell = signal('');
  protected readonly onFailAgent = signal('');
  protected readonly shells: SelectOption[] = IS_WIN
    ? [{ value: '', label: 'PowerShell' }, { value: 'cmd', label: 'CMD' }, { value: 'bash', label: 'Git Bash' }]
    : [{ value: '', label: 'Terminal (zsh)' }, { value: 'bash', label: 'Bash' }];
  /** intervalo: minutos ou horas */
  protected readonly intervalUnit = signal<'min' | 'h'>('h');
  private readonly agents = inject(AgentsService);
  /** id do agente em texto ('' = sem agente) */
  protected readonly agentId = signal('');
  protected readonly projectSlug = signal('');
  protected readonly repos = signal<Repo[]>([]);
  protected readonly repoPath = signal<string>('');
  protected readonly repoOptions = computed<SelectOption[]>(() =>
    [{ value: '', label: 'Projeto inteiro (sem worktree)' }, ...this.repos().map(r => ({ value: r.path, label: `Repositório ${r.name}` }))]);
  protected readonly prompt = signal('');
  protected readonly permission = signal<RunPermission>('edits');
  protected readonly size = signal<RunSize>('small');
  protected readonly scheduleKind = signal<'daily' | 'interval'>('daily');
  protected readonly days = signal<number[]>([1, 2, 3, 4, 5]);
  protected readonly time = signal('08:00');
  protected readonly intervalHours = signal(6);
  protected readonly maxSession = signal(80);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly schedule = computed(() => describeSchedule({
    scheduleKind: this.scheduleKind(), days: this.days(), time: this.time(), intervalHours: this.intervalHours(),
    intervalMinutes: this.intervalUnit() === 'min' ? this.intervalHours() : null,
  }));

  constructor() {
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) { this.fill(s); el.showModal(); }
      if (!s && el.open) el.close();
    });
  }

  /** escolher um agente com projeto já traz o projeto dele */
  protected selectAgent(id: string): void {
    this.agentId.set(id);
    const agent = id ? this.agents.byId().get(Number(id)) : null;
    if (agent?.projectSlug && agent.projectSlug !== this.projectSlug()) this.selectProject(agent.projectSlug);
  }

  protected async selectProject(slug: string, repo = ''): Promise<void> {
    this.projectSlug.set(slug);
    this.repoPath.set(repo);
    this.repos.set(slug ? await this.projects.repos(slug) : []);
  }

  protected toggleDay(d: number): void {
    this.days.update(list => (list.includes(d) ? list.filter(x => x !== d) : [...list, d].sort()));
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.name().trim() || !this.prompt().trim()) return;
    if (this.kind() === 'agent' && !this.projectSlug() && !this.agentId()) { this.error.set('Escolha um projeto ou um agente.'); return; }
    if (this.scheduleKind() === 'interval' && this.intervalUnit() === 'min' && this.intervalHours() < 5) { this.error.set('O intervalo mínimo é de 5 minutos.'); return; }
    if (this.scheduleKind() === 'daily' && !this.days().length) { this.error.set('Escolha pelo menos um dia.'); return; }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.routines.save(this.state()?.routine?.id ?? null, {
        kind: this.kind(), shell: this.shell(), onFailAgent: Number(this.onFailAgent()) || null,
        intervalMinutes: this.scheduleKind() === 'interval' && this.intervalUnit() === 'min' ? this.intervalHours() : null,
        name: this.name().trim(), agentId: this.kind() === 'command' ? null : Number(this.agentId()) || null, projectSlug: this.projectSlug() || null, repoPath: this.repoPath() || null, prompt: this.prompt().trim(),
        permission: this.permission(), size: this.size(), scheduleKind: this.scheduleKind(), days: this.days(), time: this.time(),
        intervalHours: this.intervalUnit() === 'h' ? this.intervalHours() : this.state()?.routine?.intervalHours ?? 24, maxSession: this.maxSession(), enabled: this.state()?.routine?.enabled ?? true,
      });
      this.closed.emit();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private fill(s: NonNullable<RoutineDialogState>): void {
    const r = s.routine ?? s.draft ?? {};
    this.name.set(r.name ?? ''); this.prompt.set(r.prompt ?? ''); this.permission.set(r.permission ?? 'edits'); this.size.set(r.size ?? 'small');
    this.scheduleKind.set(r.scheduleKind ?? 'daily'); this.days.set(r.days ?? [1, 2, 3, 4, 5]); this.time.set(r.time ?? '08:00');
    this.intervalUnit.set(r.intervalMinutes ? 'min' : 'h'); this.intervalHours.set(r.intervalMinutes ?? r.intervalHours ?? 6); this.maxSession.set(r.maxSession ?? 80);
    this.kind.set(r.kind ?? 'agent'); this.shell.set(r.shell ?? ''); this.onFailAgent.set(r.onFailAgent ? String(r.onFailAgent) : '');
    this.error.set(null); this.busy.set(false);
    this.agentId.set(r.agentId ? String(r.agentId) : '');
    const agentProject = r.agentId ? this.agents.byId().get(r.agentId)?.projectSlug : null;
    this.selectProject(r.projectSlug ?? agentProject ?? (r.agentId ? '' : this.projects.defaultSlug()), r.repoPath ?? '');
  }
}
