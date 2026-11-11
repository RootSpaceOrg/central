import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { OwnerState, Project } from '../../../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { RunsService } from '../../../../../../shared/services/runs/runs.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../../../shared/ui/markdown';
import { Switch } from '../../../../../../shared/ui/switch';
import { TodoOwner } from '../todo-owner/todo-owner';

/** o que cada evento quer dizer, em uma palavra para a lista */
const KIND: Record<string, { label: string; tone: string }> = {
  historia_validada: { label: 'História validada', tone: 'text-yes' },
  historia_devolvida: { label: 'História devolvida', tone: 'text-no' },
  entrega_devolvida: { label: 'Ajuste pedido', tone: 'text-later' },
  execucao_falhou: { label: 'Execução falhou', tone: 'text-no' },
  decisao_respondida: { label: 'Decisão respondida', tone: 'text-frost' },
  ideia_aprovada: { label: 'Ideia aprovada', tone: 'text-frost' },
  insight: { label: 'Insight', tone: 'text-[#C6A6FF]' },
  fila_vazia: { label: 'Fila vazia', tone: 'text-mute' },
  rumo_atualizado: { label: 'Rumo atualizado', tone: 'text-frost' },
  alerta: { label: 'Alerta', tone: 'text-no' },
};

/**
 * Aba Dono: quem responde pelo projeto, se ele age sozinho pelos eventos, o que espera por ele e o diário (o que fez e
 * por quê). Também o ambiente de dev em que as histórias são testadas como usuário.
 */
@Component({
  selector: 'app-owner-panel',
  imports: [AgoPipe, Icon, MarkdownPipe, RouterLink, Switch, TodoOwner],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @let p = project();
    <div class="mx-auto grid max-w-[1180px] gap-6 px-8 pt-7 pb-16 xl:grid-cols-[minmax(0,1fr)_340px] xl:px-10">
      <div class="min-w-0 space-y-5">
        <!-- quem é o dono e se ele age sozinho -->
        <section class="rounded-3xl border border-edge bg-panel p-6" aria-labelledby="ow-title">
          <div class="flex flex-wrap items-start gap-4">
            <span class="grid size-12 shrink-0 place-items-center rounded-2xl text-night" [style.background]="p.color"><app-icon name="agent" [size]="24" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="ow-title" class="font-display text-[22px] font-semibold leading-tight">{{ owner()?.name ?? 'Sem dono' }}</h2>
              <p class="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
                O dono responde pelo resultado do projeto dentro do rumo que você aprovou: transforma ideias aprovadas e
                insights em histórias, conserta o que voltou, ensina quem errou e só te chama no que é crítico.</p>
            </div>
          </div>
          <app-todo-owner class="mt-4" [project]="p" />
          @if (p.todoAgentId) {
            <app-switch class="mt-4 rounded-2xl border border-edge bg-night/40 px-4 py-3" [checked]="p.ownerOn" (changed)="toggle($event)"
                        label="Age sozinho pelos eventos"
                        hint="Acorda quando algo acontece (história validada ou devolvida, falha, decisão sua, ideia aprovada, insight de cliente ou reunião, fila vazia), sem horário fixo. No máximo 10 passadas por dia; o que já estava pendente quando você ligar é ignorado." />
          } @else {
            <p class="mt-4 rounded-2xl border border-dashed border-edge px-4 py-3 text-[13px] text-mute">Escolha um agente acima para ele ser o dono.</p>
          }
          @if (error()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ error() }}</p> }
        </section>

        <!-- diário -->
        <section aria-labelledby="ow-diary">
          <div class="mb-3 flex items-end gap-3">
            <h3 id="ow-diary" class="font-display text-[18px] font-semibold">Diário do dono</h3>
            <span class="text-[12.5px] text-faint">o que ele fez e por quê, a cada passada</span>
          </div>
          @for (d of state()?.diary ?? []; track d.runId) {
            <article class="mb-3 rounded-2xl border border-edge bg-panel px-5 py-4">
              <header class="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span class="size-2 rounded-full" [class]="d.status === 'succeeded' ? 'bg-yes' : d.status === 'failed' ? 'bg-no' : 'pulse bg-later'"></span>
                <span class="font-semibold text-text">{{ d.title }}</span>
                <span class="text-faint">· {{ d.at | ago }}</span>
                <a routerLink="/execucoes" [queryParams]="{ run: d.runId }" class="ml-auto text-frost hover:underline">ver execução</a>
              </header>
              @if (d.diary) { <div class="md mt-2 text-[14px] leading-relaxed selectable" [innerHTML]="d.diary | markdown"></div> }
              @else { <p class="mt-2 text-[13.5px] text-mute">{{ d.status === 'failed' ? 'A passada falhou antes de escrever o diário.' : 'Trabalhando…' }}</p> }
            </article>
          } @empty {
            <div class="rounded-2xl border border-dashed border-edge px-6 py-10 text-center text-[13.5px] text-mute">
              {{ p.ownerOn ? 'Ainda não houve evento que acordasse o dono. Quando algo acontecer, a passada aparece aqui.' : 'Ligue "Age sozinho pelos eventos" para o dono começar a trabalhar sem você pedir.' }}
            </div>
          }
        </section>
      </div>

      <aside class="space-y-5">
        <section class="rounded-3xl border border-edge bg-panel p-5" aria-labelledby="ow-wait">
          <h3 id="ow-wait" class="flex items-center gap-2 font-semibold">Esperando o dono
            <span class="rounded-full bg-raise px-2 text-[12px] tabular-nums text-mute">{{ state()?.pending?.length ?? 0 }}</span></h3>
          <ul class="mt-3 space-y-2.5">
            @for (e of state()?.pending ?? []; track e.id) {
              <li class="text-[13px] leading-snug">
                <span class="font-semibold {{ kind(e.kind).tone }}">{{ kind(e.kind).label }}</span><span class="text-faint">&nbsp;· {{ e.at | ago }}</span>
                <p class="mt-0.5 line-clamp-3 text-mute">{{ e.summary }}</p>
              </li>
            } @empty { <li class="text-[13px] text-faint">Nada pendente.</li> }
          </ul>
        </section>

        <section class="rounded-3xl border border-edge bg-panel p-5" aria-labelledby="ow-dev">
          <h3 id="ow-dev" class="font-semibold">Ambiente de teste</h3>
          <p class="mt-1 text-[12.5px] leading-relaxed text-mute">Onde o agente testa as histórias como usuário e de onde vem o link do seu roteiro.</p>
          <label class="mt-3 block">
            <span class="mb-1 block text-[12px] font-semibold text-mute">Link do dev publicado</span>
            <input class="field text-[13px]" placeholder="https://dev.seuproduto.com" [value]="p.devUrl ?? ''" (change)="devUrl.set($any($event.target).value)" />
          </label>
          <label class="mt-2.5 block">
            <span class="mb-1 block text-[12px] font-semibold text-mute">Como entrar (conta de teste)</span>
            <textarea class="field h-20 resize-y text-[13px]" placeholder="ex.: coordenacao@teste.com / senha no 1Password 'dev'" [value]="p.devLogin ?? ''" (change)="devLogin.set($any($event.target).value)"></textarea>
          </label>
          <button type="button" class="btn btn-sm mt-2" [disabled]="!devDirty()" (click)="saveDev()">{{ savedDev() ? 'Salvo' : 'Salvar' }}</button>
        </section>

        <section class="rounded-3xl border border-edge bg-panel p-5" aria-labelledby="ow-ops">
          <h3 id="ow-ops" class="font-semibold">Suas decisões aqui</h3>
          <p class="mt-1 text-[12.5px] leading-relaxed text-mute">Ficam registradas com o motivo: o dono consulta para seguir o seu critério.</p>
          <ul class="mt-3 space-y-2">
            @for (a of (state()?.actions ?? []).slice(0, 8); track a.id) {
              <li class="text-[12.5px] leading-snug">
                <span class="font-semibold text-text">{{ a.action }}</span><span class="text-faint">&nbsp;· {{ a.at | ago }}</span>
                <p class="line-clamp-2 text-mute">{{ a.context }}</p>
                @if (a.reason) { <p class="line-clamp-2 italic text-mute">"{{ a.reason }}"</p> }
              </li>
            } @empty { <li class="text-[12.5px] text-faint">Nada ainda.</li> }
          </ul>
        </section>

        <section class="rounded-3xl border border-edge bg-panel p-5 text-[12.5px] leading-relaxed text-mute" aria-labelledby="ow-rules">
          <h3 id="ow-rules" class="mb-1.5 text-[13.5px] font-semibold text-text">Quando ele te chama</h3>
          Só no crítico: produção com impacto no usuário que não seja hotfix, dinheiro e cobrança, dados de cliente, comunicação
          com cliente e mudança de rumo. Bug, ajuste de tela e tudo em dev ele decide. Mudar o time: faz quando você pede; por
          conta própria, propõe.
        </section>
      </aside>
    </div>`,
})
export class OwnerPanel {
  private readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly runs = inject(RunsService);

  readonly project = input.required<Project>();
  protected readonly state = signal<OwnerState | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly owner = computed(() => this.agents.byId().get(this.project().todoAgentId ?? -1) ?? null);
  protected readonly devUrl = signal<string | null>(null);
  protected readonly devLogin = signal<string | null>(null);
  protected readonly savedDev = signal(false);
  protected readonly devDirty = computed(() => (this.devUrl() !== null && this.devUrl() !== (this.project().devUrl ?? ''))
    || (this.devLogin() !== null && this.devLogin() !== (this.project().devLogin ?? '')));

  constructor() {
    // recarrega quando muda de projeto, quando liga/desliga e quando alguma execução anda (passadas novas)
    effect(() => { this.project().slug; this.project().ownerOn; this.runs.runs().length; this.load(); });
  }

  protected kind(k: string) { return KIND[k] ?? { label: k, tone: 'text-mute' }; }

  private load(): void {
    this.projects.owner(this.project().slug).then(s => this.state.set(s), e => this.error.set((e as Error).message));
  }

  protected async toggle(on: boolean): Promise<void> {
    this.error.set(null);
    try { await this.projects.setOwnerOn(this.project().slug, on); this.load(); }
    catch (e) { this.error.set((e as Error).message); }
  }

  protected async saveDev(): Promise<void> {
    const p = this.project();
    await this.projects.setDev(p.slug, (this.devUrl() ?? p.devUrl ?? '').trim() || null, (this.devLogin() ?? p.devLogin ?? '').trim() || null);
    this.devUrl.set(null); this.devLogin.set(null); this.savedDev.set(true);
    setTimeout(() => this.savedDev.set(false), 2000);
  }
}
