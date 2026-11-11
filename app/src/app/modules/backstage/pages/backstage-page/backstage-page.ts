import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BoardService } from '../../../../shared/services/board/board.service';
import { DeliveriesService } from '../../../../shared/services/deliveries/deliveries.service';
import { IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { LayoutService } from '../../../../shared/services/layout/layout.service';
import { LiveService } from '../../../../shared/services/live/live.service';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { RoutinesService } from '../../../../shared/services/routines/routines.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { TasksService } from '../../../../shared/services/tasks/tasks.service';
import { Icon, IconName } from '../../../../shared/ui/icon';
import { Switch } from '../../../../shared/ui/switch';

interface Room { path: string; label: string; icon: IconName; what: string; count?: () => string | null }

/**
 * Bastidores: tudo o que faz a Central andar, para quando você quiser olhar por dentro. No dia a dia a Mesa basta; aqui
 * fica a operação (backlog, quadros, execuções, agentes, rotinas…) com o número de cada uma.
 */
@Component({
  selector: 'app-backstage-page',
  imports: [Icon, RouterLink, Switch],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-[1120px] px-8 pt-10 pb-24 xl:px-10">
      <h1 class="font-display text-[36px] font-bold leading-tight tracking-tight">Bastidores</h1>
      <p class="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-mute">Onde a operação acontece. Os donos e os agentes cuidam daqui; você entra quando quiser ver por dentro ou ajustar algo fino.</p>

      @for (g of groups; track g.title) {
        <section class="mt-9" [attr.aria-label]="g.title">
          <h2 class="text-[12px] font-semibold uppercase tracking-wider text-faint">{{ g.title }}</h2>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            @for (r of g.rooms; track r.path) {
              <a [routerLink]="r.path" class="group flex items-start gap-3.5 rounded-2xl border border-edge bg-panel px-4 py-3.5 transition hover:border-faint hover:bg-raise/40">
                <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-night text-mute transition group-hover:text-text"><app-icon [name]="r.icon" [size]="19" /></span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2 font-semibold">{{ r.label }}
                    @if (r.count?.(); as c) { <span class="rounded-full bg-raise px-2 text-[11.5px] font-normal tabular-nums text-mute">{{ c }}</span> }</span>
                  <span class="mt-0.5 block text-[13px] leading-snug text-mute">{{ r.what }}</span>
                </span>
              </a>
            }
          </div>
        </section>
      }

      <section class="mt-10 rounded-3xl border border-edge bg-panel px-5 py-4">
        <app-switch [checked]="layout.operator()" (changed)="layout.setOperator($event)" label="Modo operador: todas as telas na barra"
                    hint="Desligado, a barra mostra só a Mesa, o Estúdio e os Bastidores. Ligado, volta a barra completa (Triagem, Revisão, Backlog, Agentes, Rotinas, Escritório, Grade)." />
      </section>
    </div>`,
})
export class BackstagePage {
  protected readonly layout = inject(LayoutService);
  private readonly tasks = inject(TasksService);
  private readonly runs = inject(RunsService);
  private readonly deliveries = inject(DeliveriesService);
  private readonly proposals = inject(ProposalsService);
  private readonly ideas = inject(IdeasService);
  private readonly boards = inject(BoardService);
  private readonly routines = inject(RoutinesService);
  private readonly live = inject(LiveService);

  private readonly n = (v: number, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : null);
  private readonly open = computed(() => this.tasks.tasks().filter(t => t.column !== 'done' && !t.parentId).length);

  protected readonly groups: { title: string; rooms: Room[] }[] = [
    {
      title: 'Entrada', rooms: [
        { path: '/triagem', label: 'Triagem', icon: 'inbox', what: 'Todas as decisões e ideias, uma a uma, com atalhos.',
          count: () => this.n(this.proposals.inbox().length + this.ideas.fresh().length, 'item', 'itens') },
        { path: '/ideias', label: 'Ideias', icon: 'ideas', what: 'O que foi anotado, aprovado e virou trabalho.' },
        { path: '/revisao', label: 'Revisão', icon: 'pr', what: 'Entregas com o detalhe técnico (PR, diff, execução).',
          count: () => this.n(this.deliveries.board().length, 'entrega', 'entregas') },
      ],
    },
    {
      title: 'Trabalho', rooms: [
        { path: '/backlog', label: 'Backlog', icon: 'kanban', what: 'Histórias e tarefas de todos os projetos, por coluna.', count: () => this.n(this.open(), 'aberta', 'abertas') },
        { path: '/quadros', label: 'Quadros', icon: 'workflow', what: 'Fluxos com uma etapa por agente (ex.: a linha de produção).', count: () => this.n(this.boards.boards().length, 'quadro', 'quadros') },
        { path: '/execucoes', label: 'Execuções', icon: 'activity', what: 'Cada vez que um agente trabalhou: log, custo, resultado.',
          count: () => this.n(this.runs.active().length, 'rodando', 'rodando') },
        { path: '/painel', label: 'Painel do operador', icon: 'home', what: 'O Início antigo: tudo o que aconteceu, cota, automações.' },
        { path: '/visao-geral', label: 'Visão geral', icon: 'overview', what: 'Commits e atividade de todos os repositórios.' },
      ],
    },
    {
      title: 'Time', rooms: [
        { path: '/agentes', label: 'Agentes', icon: 'agent', what: 'Quem é quem, instruções, memória e liberdade de cada um.' },
        { path: '/rotinas', label: 'Rotinas', icon: 'routine', what: 'O que roda na agenda (extras periódicos, resumos).',
          count: () => this.n(this.routines.routines().filter(r => r.enabled).length, 'ativa', 'ativas') },
        { path: '/escritorio', label: 'Escritório', icon: 'office', what: 'O time trabalhando, em 3D.', count: () => this.n(this.live.items().size, 'trabalhando', 'trabalhando') },
        { path: '/grade', label: 'Grade', icon: 'grid', what: 'Sessões e terminais lado a lado.' },
        { path: '/extensoes', label: 'Extensões', icon: 'puzzle', what: 'WhatsApp, transcrição e outras integrações.' },
      ],
    },
  ];
}
