import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { DeliveriesService, Digest } from '../../../../../../shared/services/deliveries/deliveries.service';
import { Project } from '../../../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';

interface Group {
  project: Project | null;
  name: string;
  deliveries: Digest['deliveries'];
  done: Digest['tasksDone'];
  roadmap: Digest['roadmap'];
}

const EVENT: Record<string, string> = { created: 'novo marco', moved: 'marco andou', done: 'marco concluído', edited: 'marco ajustado', deleted: 'marco removido' };

/** O que um prompt curto precisa para a Central resumir (sem mandar o digest inteiro). */
function brief(d: Digest, name: (slug: string | null) => string): string {
  const lines = [
    `Desde ${d.since.toLocaleString('pt-BR')}: ${d.runs} execuções (${Math.round(d.minutes / 60)}h de agente), ${d.tasksDone.length} tarefas concluídas, ${d.ideas} ideias novas, ${d.decisions} decisões novas.`,
    'Entregas:',
    ...d.deliveries.slice(0, 30).map(x => `- [${name(x.projectSlug)}] ${x.title}${x.failed ? ' (não terminou)' : ''}${x.files ? ` (${x.files} arquivos)` : ''}: ${x.what.slice(0, 200)}${x.risks ? ` | riscos: ${x.risks.slice(0, 120)}` : ''}`),
    'Roadmap:',
    ...d.roadmap.slice(0, 20).map(e => `- [${name(e.projectSlug)}] ${EVENT[e.kind] ?? e.kind}: ${e.title}${e.detail ? ` (${e.detail.slice(0, 100)})` : ''}`),
  ];
  return `[resumo:fora] O Gustavo voltou. Resuma em até 6 linhas, em português, sem alarde: o que avançou de verdade (por projeto, o mais importante primeiro),
o que precisa dele e o próximo passo que você sugere. Não liste tudo; não invente. Dados:

${lines.join('\n')}`;
}

/**
 * "Enquanto você estava fora": o que os agentes entregaram, o que concluiu, o que andou no roadmap e o que surgiu,
 * por projeto, desde a última visita. A Central escreve o resumo em texto quando você pede.
 */
@Component({
  selector: 'app-away-digest',
  imports: [RouterLink, Icon, AgoPipe, ProjectAvatar, MarkdownPipe],
  host: { class: 'block' },
  template: `
    @if (digest(); as d) {
      @if (empty()) {
        <!-- nada aconteceu: não ocupa espaço -->
      } @else {
        <section class="mt-9 rounded-3xl border border-edge bg-panel p-6" aria-labelledby="fora">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="fora" class="font-display text-xl font-semibold">Enquanto você estava fora</h2>
            <span class="text-[13px] text-faint">desde {{ d.since | ago }}</span>
            <span class="flex-1"></span>
            <button type="button" class="text-[13px] text-mute hover:text-text" (click)="seen.emit()">Já vi</button>
          </div>

          <!-- números -->
          <div class="mt-4 flex flex-wrap gap-2 text-[13px]">
            @for (s of stats(); track s.label) {
              <span class="rounded-full border border-edge bg-night px-3 py-1"><b class="tabular-nums">{{ s.n }}</b> {{ s.label }}</span>
            }
          </div>

          <!-- resumo da Central -->
          <div class="mt-4 rounded-2xl bg-night px-4 py-3">
            @if (narrative(); as text) {
              <div class="md text-[14px] leading-relaxed" [innerHTML]="text | markdown"></div>
            } @else if (narrating()) {
              <p class="flex items-center gap-2 text-[13.5px] text-mute"><span class="typing-dots"><i></i><i></i><i></i></span>A Central está lendo o que aconteceu…</p>
            } @else {
              <button type="button" class="flex items-center gap-2 text-[13.5px] text-frost hover:underline" (click)="narrate()">
                <app-icon name="spark" [size]="15" />Pedir à Central um resumo em texto</button>
            }
            @if (error()) { <p role="alert" class="mt-1 text-[12.5px] text-no">{{ error() }}</p> }
          </div>

          <!-- por projeto -->
          <div class="mt-5 space-y-5">
            @for (g of groups(); track g.name) {
              <div>
                <p class="flex items-center gap-2 font-semibold">
                  @if (g.project) { <app-project-avatar [project]="g.project" [size]="20" /> }
                  <span [style.color]="g.project?.color">{{ g.name }}</span>
                </p>
                <ul class="mt-1.5 space-y-1 border-l border-edge pl-4 text-[13.5px]">
                  @for (x of g.deliveries; track x.id) {
                    <li class="flex items-start gap-2">
                      @if (x.failed) { <app-icon name="close" [size]="13" class="mt-1 shrink-0 text-later" title="Não terminou" /> }
                      @else { <app-icon name="check" [size]="13" class="mt-1 shrink-0 text-yes" /> }
                      <span class="min-w-0">
                        <span>{{ x.title }}</span>
                        <span class="text-faint"> · {{ x.agentName ?? 'agente' }}@if (x.files) { · {{ x.files }} arquivos }</span>
                        @if (!x.explained) { <span class="ml-1 rounded bg-raise px-1 text-[11px] text-faint" title="O agente não contou o que fez; o texto veio do resultado">sem explicação</span> }
                        @if (x.status === 'review') { <span class="ml-1 rounded bg-frost/15 px-1 text-[11px] text-frost">para revisar</span> }
                      </span>
                    </li>
                  }
                  @for (t of g.done; track t.id) {
                    <li class="flex items-start gap-2 text-mute"><app-icon name="kanban" [size]="13" class="mt-1 shrink-0" />Concluída: {{ t.title }}</li>
                  }
                  @for (e of g.roadmap; track $index) {
                    <li class="flex items-start gap-2 text-mute"><app-icon name="roadmap" [size]="13" class="mt-1 shrink-0 text-frost" />
                      <span>{{ eventLabel(e.kind) }}: <span class="text-text">{{ e.title }}</span>@if (e.detail) { <span class="text-faint"> · {{ e.detail }}</span> }</span></li>
                  }
                </ul>
              </div>
            }
          </div>

          @if (d.ideas || d.decisions || d.memories) {
            <p class="mt-5 text-[13px] text-mute">
              Surgiu para você:
              @if (d.ideas) { <a routerLink="/triagem" class="text-frost hover:underline">{{ d.ideas }} {{ d.ideas === 1 ? 'ideia' : 'ideias' }}</a> }
              @if (d.decisions) { · <a routerLink="/triagem" class="text-frost hover:underline">{{ d.decisions }} {{ d.decisions === 1 ? 'decisão' : 'decisões' }}</a> }
              @if (d.memories) { · <a routerLink="/agentes" class="text-frost hover:underline">{{ d.memories }} {{ d.memories === 1 ? 'memória nova' : 'memórias novas' }}</a> dos agentes }
            </p>
          }
        </section>
      }
    }
  `,
})
export class AwayDigest {
  private readonly deliveries = inject(DeliveriesService);
  private readonly projects = inject(ProjectsService);
  private readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);

  /** desde quando (última visita) */
  readonly since = input.required<Date>();
  readonly seen = output<void>();

  protected readonly digest = signal<Digest | null>(null);
  protected readonly narrating = signal(false);
  protected readonly narrative = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private chatId: number | null = null;

  protected readonly empty = computed(() => {
    const d = this.digest();
    return !d || (!d.deliveries.length && !d.tasksDone.length && !d.roadmap.length && !d.ideas && !d.decisions);
  });

  protected readonly stats = computed(() => {
    const d = this.digest();
    if (!d) return [];
    const failed = d.deliveries.filter(x => x.failed).length;
    return [
      { n: d.deliveries.length - failed, label: d.deliveries.length - failed === 1 ? 'entrega' : 'entregas' },
      { n: d.tasksDone.length, label: d.tasksDone.length === 1 ? 'tarefa concluída' : 'tarefas concluídas' },
      { n: d.roadmap.filter(e => e.kind === 'done').length, label: 'marcos concluídos' },
      { n: d.runs, label: `${d.runs === 1 ? 'execução' : 'execuções'} · ${d.minutes >= 60 ? `${Math.round(d.minutes / 60)}h` : `${d.minutes}min`} de agente` },
      { n: failed, label: failed === 1 ? 'não terminou' : 'não terminaram' },
    ].filter(s => s.n);
  });

  protected readonly groups = computed<Group[]>(() => {
    const d = this.digest();
    if (!d) return [];
    const map = new Map<string, Group>();
    const of = (slug: string | null) => {
      const k = slug ?? '';
      let g = map.get(k);
      if (!g) map.set(k, (g = { project: slug ? this.projects.bySlug().get(slug) ?? null : null, name: this.name(slug), deliveries: [], done: [], roadmap: [] }));
      return g;
    };
    for (const x of d.deliveries) of(x.projectSlug).deliveries.push(x);
    // tarefa concluída que já aparece como entrega não repete
    const delivered = new Set(d.deliveries.map(x => x.taskId).filter(Boolean));
    for (const t of d.tasksDone) if (!delivered.has(t.id)) of(t.projectSlug).done.push(t);
    for (const e of d.roadmap) of(e.projectSlug).roadmap.push(e);
    return [...map.values()].sort((a, b) => b.deliveries.length + b.roadmap.length - (a.deliveries.length + a.roadmap.length));
  });

  constructor() {
    effect(() => {
      const since = this.since();
      this.deliveries.changed();
      this.deliveries.digest(since).then(d => this.digest.set(d));
    });
    effect(() => { this.since(); this.narrative.set(null); });
    // a Central terminou de resumir: pega a resposta
    effect(() => {
      const busy = this.chat.busy();
      if (this.chatId && this.narrating() && !busy.has(this.chatId)) {
        this.chat.lastReply(this.chatId).then(t => { if (t) { this.narrative.set(t); this.narrating.set(false); } });
      }
    });
  }

  protected eventLabel(kind: string): string { return EVENT[kind] ?? kind; }

  private name(slug: string | null): string { return slug ? this.projects.bySlug().get(slug)?.name ?? slug : 'Sem projeto'; }

  protected async narrate(): Promise<void> {
    const d = this.digest(), central = this.agents.central();
    if (!d || !central) return;
    this.narrating.set(true);
    this.error.set(null);
    try {
      this.chatId = await this.chat.startBackground(central.id, brief(d, s => this.name(s)));
    } catch (e) {
      this.error.set((e as Error).message);
      this.narrating.set(false);
    }
  }
}
