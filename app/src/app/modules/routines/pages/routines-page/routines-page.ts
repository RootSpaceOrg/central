import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AgentsService } from '../../../../shared/services/agents/agents.service';

import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { RoutineDialog, RoutineDialogState } from '../../components/routine-dialog/routine-dialog';
import { Routine, RoutineDraft, RoutinesService, describeSchedule } from '../../../../shared/services/routines/routines.service';

import { AskService } from '../../../../shared/services/ask/ask.service';
/** Modelos para começar sem escrever do zero (todos no projeto inteiro, modo seguro: só leem e organizam). */
const TEMPLATES: { title: string; hint: string; draft: Partial<RoutineDraft> }[] = [
  {
    title: 'Revisar PRs toda manhã', hint: 'Dias úteis às 08:00',
    draft: {
      name: 'Revisar PRs abertos', scheduleKind: 'daily', days: [1, 2, 3, 4, 5], time: '08:00', size: 'small',
      prompt: 'Liste os PRs abertos dos repositórios deste projeto (gh pr list em cada um). Para cada PR parado há mais de 3 dias ou com CI falhando, crie uma decisão na Central com o próximo passo sugerido. Se um PR já foi resolvido, mova a tarefa correspondente.',
    },
  },
  {
    title: 'Triagem semanal do backlog', hint: 'Segunda às 09:00',
    draft: {
      name: 'Triagem do backlog', scheduleKind: 'daily', days: [1], time: '09:00', size: 'small',
      prompt: 'Revise o backlog deste projeto na Central: junte tarefas duplicadas, ajuste prioridades, mova para "A fazer" o que já tem contexto suficiente e transforme em tarefa as ideias que amadureceram. No fim, resuma o que mudou.',
    },
  },
  {
    title: 'Olhar o que entrou ontem', hint: 'Todo dia às 07:00',
    draft: {
      name: 'Revisão dos commits de ontem', scheduleKind: 'daily', days: [0, 1, 2, 3, 4, 5, 6], time: '07:00', size: 'small',
      prompt: 'Leia os commits das últimas 24 horas nos repositórios deste projeto. Procure regressões prováveis, TODOs novos e trabalho pela metade. Registre o que precisa de atenção como tarefa no backlog, com o arquivo e o motivo.',
    },
  },
  {
    title: 'Saúde dos repositórios', hint: 'Sexta às 17:00',
    draft: {
      name: 'Saúde dos repositórios', scheduleKind: 'daily', days: [5], time: '17:00', size: 'small',
      prompt: 'Verifique os repositórios deste projeto: mudanças sem commit, branches antigas sem merge, PRs esquecidos e dependências muito desatualizadas. Crie tarefas no backlog para o que vale resolver e uma decisão se algo for arriscado.',
    },
  },
];

@Component({
  selector: 'app-routines-page',
  imports: [RouterLink, Icon, AgoPipe, ProjectAvatar, RoutineDialog],
  templateUrl: './routines-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class RoutinesPage {
  private readonly ask = inject(AskService);
  protected readonly routines = inject(RoutinesService);
  protected readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);
  private readonly agentsService = inject(AgentsService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  private readonly scope = inject(ScopeService);
  /** do projeto da barra lateral: a rotina dele ou do agente dele */
  /** a próxima a rodar primeiro; as desligadas no fim */
  protected readonly shown = computed(() => this.routines.routines()
    .filter(r => this.scope.matches(r.projectSlug ?? this.agent(r.agentId)?.projectSlug))
    .sort((a, b) => +b.enabled - +a.enabled || +a.nextRunAt - +b.nextRunAt));
  protected readonly templates = TEMPLATES;
  protected readonly dialog = signal<RoutineDialogState>(null);
  protected readonly describe = describeSchedule;
  protected readonly firing = signal<number | null>(null);

  constructor() {
    // ?nova=1&agente=3: vindo da tela Agentes ("Nova rotina")
    if (this.query.get('nova')) {
      const agentId = Number(this.query.get('agente')) || null;
      queueMicrotask(() => this.dialog.set({ routine: null, draft: { agentId, projectSlug: null } }));
    }
  }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }
  protected agent(id: number | null) { return id ? this.agentsService.byId().get(id) ?? null : null; }
  protected repoName(path: string | null) { return path?.split(/[\\/]/).pop() ?? null; }

  /** relógio da tela: a contagem "roda em X min" anda sozinha */
  private readonly now = signal(Date.now());
  private readonly clock = (() => { const t = setInterval(() => this.now.set(Date.now()), 30_000); inject(DestroyRef).onDestroy(() => clearInterval(t)); })();

  /** próxima execução: em até 24 h como contagem ("roda em 12 min", "roda em 1h30"); depois, o dia e a hora */
  protected next(d: Date): string {
    const min = Math.round((d.getTime() - this.now()) / 60_000);
    if (min > 24 * 60) return `próxima ${this.when(d)}`;
    if (min <= 0) return 'roda em instantes';
    if (min < 60) return `roda em ${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return `roda em ${h}h${m ? String(m).padStart(2, '0') : ''}`;
  }

  protected when(d: Date): string {
    const today = new Date();
    const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return `hoje às ${time}`;
    if (d.toDateString() === tomorrow.toDateString()) return `amanhã às ${time}`;
    return d.toLocaleString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected async fire(r: Routine): Promise<void> {
    this.firing.set(r.id);
    const run = await this.routines.fire(r);
    this.firing.set(null);
    if (run) this.router.navigate(['/execucoes'], { queryParams: { run } });
  }

  protected async remove(r: Routine): Promise<void> {
    if (await this.ask.confirm(`Excluir a rotina "${r.name}"?`, { confirmLabel: 'Excluir rotina', danger: true })) this.routines.remove(r);
  }
}
