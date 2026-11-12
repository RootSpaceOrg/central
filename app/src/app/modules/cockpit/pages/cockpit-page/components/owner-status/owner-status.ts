import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { LiveService, PHASES } from '../../../../../../shared/services/live/live.service';
import { ProposalsService } from '../../../../../../shared/services/proposals/proposals.service';
import { RunsService } from '../../../../../../shared/services/runs/runs.service';
import { TasksService } from '../../../../../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';
import { Cleaned, CockpitService, Instrument } from '../../../../services/cockpit/cockpit.service';

const STATE = {
  working: { label: 'Trabalhando', tone: 'text-yes' }, waiting: { label: 'Esperando você', tone: 'text-later' },
  watching: { label: 'Atento', tone: 'text-mute' }, off: { label: 'Parado', tone: 'text-faint' }, none: { label: 'Sem dono', tone: 'text-faint' },
} as const;

/**
 * Ao clicar no rosto do dono: o porquê do estado. Trabalhando no quê (cada execução do produto agora, com a etapa e o
 * que está fazendo), esperando você pelo quê (decisões, bloqueios, pedido de 1:1) e, atento, o que ele fez por último e
 * o que está na fila dele.
 */
@Component({
  selector: 'app-owner-status',
  imports: [AgoPipe, Icon, ProjectAvatar, RouterLink],
  host: { class: 'block' },
  template: `
    @let p = product();
    <div class="w-[380px] rounded-2xl border border-edge bg-raise shadow-[0_24px_60px_-20px_rgb(0_0_0/0.85)]" role="dialog" [attr.aria-label]="'Dono de ' + p.name">
      <header class="flex items-center gap-3 border-b border-edge px-4 py-3">
        @if (p.owner) { <app-project-avatar [project]="$any(p.owner)" [size]="30" /> }
        <div class="min-w-0 flex-1 leading-tight">
          <p class="truncate font-semibold">{{ p.owner?.name ?? 'Sem dono' }}</p>
          <p class="text-[11.5px] text-faint">dono de {{ p.name }}@if (p.techLead && p.techLead.id !== p.owner?.id) { · tech lead: {{ p.techLead.name }} }</p>
        </div>
        <span class="text-[12px] font-bold {{ state().tone }}">{{ state().label }}</span>
      </header>

      <div class="max-h-[60vh] space-y-4 overflow-y-auto px-4 py-3.5">
        <!-- trabalhando no quê -->
        @if (working().length) {
          <section>
            <h4 class="text-[10.5px] font-bold uppercase tracking-wider text-faint">Agora no produto</h4>
            <ul class="mt-2 space-y-2">
              @for (w of working(); track w.id) {
                <li>
                  <a routerLink="/execucoes" [queryParams]="{ run: w.id }" (click)="close.emit()" class="block rounded-xl bg-night/60 px-3 py-2 hover:bg-night">
                    <p class="flex items-center gap-2 text-[12px]">
                      <span class="pulse size-1.5 rounded-full bg-yes"></span>
                      <span class="font-semibold">{{ w.agent }}</span>
                      @if (w.phase) { <span class="rounded-full px-1.5 text-[10.5px] font-semibold" [style.color]="w.phase.color" [style.background]="w.phase.color + '22'">{{ w.phase.label }}</span> }
                      <span class="ml-auto text-faint">{{ w.since | ago }}</span>
                    </p>
                    <p class="mt-0.5 line-clamp-2 text-[13px] leading-snug">{{ w.title }}</p>
                    @if (w.doing) { <p class="mt-0.5 line-clamp-2 text-[12px] text-mute">{{ w.doing }}</p> }
                    @if (w.plan) { <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-edge"><div class="h-full rounded-full bg-yes" [style.width.%]="w.plan"></div></div> }
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <!-- esperando você pelo quê -->
        @if (decisions().length || blockers().length || p.oneOnOne) {
          <section>
            <h4 class="text-[10.5px] font-bold uppercase tracking-wider text-later">Esperando você</h4>
            <ul class="mt-2 space-y-1.5 text-[13px]">
              @if (p.oneOnOne) {
                <li><a [routerLink]="['/produtos', p.slug]" (click)="close.emit()" class="flex gap-2 rounded-lg px-2 py-1.5 hover:bg-night"><app-icon name="central" [size]="14" class="mt-0.5 shrink-0 text-[#C6A6FF]" /><span><b>Pediu um 1:1:</b> {{ p.oneOnOne.why }}</span></a></li>
              }
              @for (b of blockers(); track b.id) {
                <li class="flex gap-2 rounded-lg px-2 py-1.5"><app-icon name="timer" [size]="14" class="mt-0.5 shrink-0 text-later" /><span><b>Só você destrava:</b> {{ b.waiting!.reason }}</span></li>
              }
              @for (d of decisions(); track d.id) {
                <li><a routerLink="/triagem" (click)="close.emit()" class="flex gap-2 rounded-lg px-2 py-1.5 hover:bg-night">
                  <app-icon name="inbox" [size]="14" class="mt-0.5 shrink-0 text-later" />
                  <span class="min-w-0"><span class="line-clamp-2">{{ d.title }}</span><span class="text-[11.5px] text-faint">{{ agentName(d.agentId) }} · {{ d.createdAt | ago }}</span></span></a></li>
              }
            </ul>
          </section>
        }

        <!-- faxina: o que ele tirou da sua frente -->
        @if (cleaned().length) {
          <section>
            <h4 class="text-[10.5px] font-bold uppercase tracking-wider text-yes">Limpou para você · 48 h</h4>
            <ul class="mt-2 space-y-1.5">
              @for (c of cleaned(); track c.kind + c.id) {
                <li class="rounded-lg bg-night/50 px-2.5 py-2 text-[12.5px]">
                  <p class="flex items-start gap-2">
                    <span class="mt-px shrink-0 rounded-full bg-yes/15 px-1.5 text-[10.5px] font-semibold text-yes">{{ c.kind === 'decision' ? 'decisão' : 'revisão' }} · {{ c.how }}</span>
                    <span class="min-w-0 flex-1 line-clamp-2 font-semibold">{{ c.title }}</span>
                    <button type="button" class="shrink-0 text-[11.5px] text-frost hover:underline" (click)="reopen(c)">reabrir</button>
                  </p>
                  <p class="mt-0.5 line-clamp-3 text-mute">{{ c.why }} <span class="text-faint">· {{ c.by }}, {{ c.at | ago }}</span></p>
                </li>
              }
            </ul>
          </section>
        }

        <!-- atento: o que fez e o que está na fila -->
        <section>
          <h4 class="text-[10.5px] font-bold uppercase tracking-wider text-faint">Último que ele fez</h4>
          @if (p.diary?.text) { <p class="mt-1.5 text-[13px] leading-snug text-mute"><span class="text-faint">{{ p.diary!.at | ago }} ·</span> {{ p.diary!.text }}</p> }
          @else { <p class="mt-1.5 text-[13px] text-faint">{{ p.ownerOn ? 'Ainda nenhuma passada.' : 'Dono parado: só age quando você pede.' }}</p> }
          @if (p.ownerOn) {
            <p class="mt-2 text-[12px] text-faint">{{ p.pendingEvents ? p.pendingEvents + (p.pendingEvents === 1 ? ' evento na fila dele (ele acorda em poucos minutos)' : ' eventos na fila dele (ele acorda em poucos minutos)') : 'Nada na fila: acorda quando algo acontecer.' }}</p>
          }
        </section>
      </div>

      <footer class="border-t border-edge px-4 py-2.5">
        <a [routerLink]="['/produtos', p.slug]" (click)="close.emit()" class="flex items-center justify-between text-[12.5px] font-semibold text-frost hover:underline">Abrir a sala do produto <app-icon name="arrowRight" [size]="13" /></a>
      </footer>
    </div>`,
})
export class OwnerStatus {
  private readonly runs = inject(RunsService);
  private readonly live = inject(LiveService);
  private readonly proposals = inject(ProposalsService);
  private readonly agents = inject(AgentsService);
  private readonly tasks = inject(TasksService);
  readonly product = input.required<Instrument>();
  readonly close = output<void>();

  protected readonly state = computed(() => STATE[this.product().ownerState]);
  /** cada execução do produto agora: quem, o quê, a etapa e o que está fazendo */
  protected readonly working = computed(() => {
    const slug = this.product().slug;
    const titles = new Map(this.tasks.tasks().map(t => [t.id, t.title]));
    return this.runs.active().filter(r => r.projectSlug === slug).map(r => {
      const a = this.live.items().get(`run:${r.id}`);
      const done = a?.plan.filter(p => p.status === 'completed').length ?? 0;
      return {
        id: r.id,
        agent: this.agents.byId().get(r.agentId ?? -1)?.name ?? 'agente',
        title: (r.taskId && titles.get(r.taskId)) || r.title.replace(/^\[[^\]]+\]\s*/, ''),
        phase: a?.phase ? PHASES[a.phase] : null,
        doing: a?.status?.doing ?? a?.step ?? null,
        plan: a?.plan.length ? Math.round((done / a.plan.length) * 100) : 0,
        since: r.startedAt ?? r.createdAt,
      };
    });
  });
  protected readonly decisions = computed(() => this.proposals.inbox().filter(p => p.projectSlug === this.product().slug));
  protected readonly blockers = computed(() => this.runs.waiting().filter(r => r.projectSlug === this.product().slug));
  /** o que o dono fechou por você (carrega ao abrir o painel) */
  protected readonly cleaned = signal<Cleaned[]>([]);
  private readonly cockpit = inject(CockpitService);
  private readonly loadCleaned = effect(() => { const s = this.product().slug; this.product().cleaned; untracked(() => this.cockpit.closed(s).then(l => this.cleaned.set(l), () => {})); });
  protected async reopen(c: Cleaned): Promise<void> {
    await this.cockpit.reopen(c);
    this.cleaned.update(l => l.filter(x => !(x.kind === c.kind && x.id === c.id)));
  }
  protected agentName(id: number | null): string { return (id && this.agents.byId().get(id)?.name) || 'agente'; }
}
