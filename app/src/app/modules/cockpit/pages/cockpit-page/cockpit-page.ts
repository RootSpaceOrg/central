import { Component, computed, inject, signal } from '@angular/core';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { MeetingImport } from '../../../../shared/components/meeting-import/meeting-import';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { LayoutService } from '../../../../shared/services/layout/layout.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Company, CockpitService, Instrument } from '../../services/cockpit/cockpit.service';
import { RouterLink } from '@angular/router';
import { ForYou } from './components/for-you/for-you';
import { InstrumentCard } from './components/instrument/instrument';

/**
 * Cockpit: a tela que fica aberta o dia todo. À esquerda os produtos por empresa, cada um com seus instrumentos, e em cima
 * só o que é do Gustavo; à direita o chefe de gabinete (sempre a Central), para pedir e conversar sem trocar de tela.
 */
@Component({
  selector: 'app-cockpit-page',
  imports: [AgoPipe, ChatView, ForYou, Icon, InstrumentCard, MeetingImport, ProjectAvatar, RouterLink],
  host: { class: 'grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px]' },
  template: `
    <main class="min-h-0 overflow-y-auto">
      <div class="mx-auto max-w-[1240px] px-8 pt-8 pb-24">
        <!-- cabeçalho: o dia e o pulso da operação -->
        <header class="ck-rise flex flex-wrap items-end gap-x-8 gap-y-4">
          <div class="mr-auto">
            <p class="text-[13px] text-mute first-letter:uppercase">{{ date }}</p>
            <h1 class="mt-0.5 font-display text-[34px] font-bold leading-[1.05] tracking-tight">{{ greeting }}, Gustavo.</h1>
          </div>
          <dl class="flex gap-6">
            <div>
              <dt class="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Agora</dt>
              <dd class="mt-0.5 flex items-center gap-2 font-display text-[22px] font-bold tabular-nums">
                @if (working()) { <span class="pulse size-2 rounded-full bg-yes"></span> }{{ working() }}<span class="text-[13px] font-normal text-mute">{{ working() === 1 ? 'agente' : 'agentes' }}</span></dd>
            </div>
            <div>
              <dt class="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Semana</dt>
              <dd class="mt-0.5 font-display text-[22px] font-bold tabular-nums">{{ week().delivered }}<span class="text-[13px] font-normal text-mute"> entregues</span></dd>
            </div>
            <div>
              <dt class="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Validadas</dt>
              <dd class="mt-0.5 font-display text-[22px] font-bold tabular-nums text-yes">{{ week().validated }}@if (week().returned) {<span class="text-[13px] font-normal text-later"> · {{ week().returned }} voltaram</span>}</dd>
            </div>
          </dl>
          <button type="button" class="btn btn-sm self-center" (click)="layout.present()" title="Abre uma janela com os produtos e o escritório para deixar num monitor da mesa (vai para o outro monitor, em tela cheia; F11 alterna)">
            <app-icon name="layers" [size]="14" />Apresentação</button>
        </header>

        <app-for-you class="mt-8 block" />

        <!-- produtos por empresa -->
        @for (c of live(); track c.slug; let ci = $index) {
          <section class="mt-10" [attr.aria-label]="c.name">
            <div class="ck-rise flex items-center gap-2.5" [style.--i]="ci * 2">
              <app-project-avatar [project]="$any(c)" [size]="20" />
              <h2 class="text-[12px] font-bold uppercase tracking-[.14em] text-mute">{{ c.name }}</h2>
              <span class="h-px flex-1 bg-gradient-to-r from-edge to-transparent"></span>
            </div>
            <div class="mt-3 grid items-stretch gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              @for (p of c.products; track p.slug; let pi = $index) {
                <app-instrument class="ck-rise" [style.--i]="ci * 2 + pi + 1" [product]="p" />
              }
            </div>
          </section>
        } @empty {
          @if (cockpit.loaded() && !dormant().length) {
            <p class="mt-16 text-center text-mute">Nenhum produto ativo ainda. Adicione um projeto pela barra lateral nos Bastidores.</p>
          }
        }
        @if (dormant().length) {
          <p class="mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-faint">
            <span>Sem dono e parados:</span>
            @for (p of dormant(); track p.slug; let last = $last) {
              <a [routerLink]="['/produtos', p.slug]" class="text-mute hover:text-text hover:underline">{{ p.name }}</a>@if (!last) {<span>·</span>}
            }
            <span>— dê um dono para eles entrarem no cockpit.</span>
          </p>
        }
      </div>
    </main>

    <!-- chefe de gabinete: sempre a Central -->
    <aside class="hidden min-h-0 flex-col border-l border-edge bg-panel/60 xl:flex" aria-label="Chefe de gabinete">
      <header class="flex items-center gap-3 border-b border-edge px-5 py-3.5">
        @if (central(); as c) {
          <span class="relative">
            <app-project-avatar [project]="c" [size]="30" />
            @if (chiefBusy()) { <span class="pulse absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-yes ring-2 ring-panel"></span> }
          </span>
        }
        <div class="min-w-0 flex-1 leading-tight">
          <p class="font-semibold">Central</p>
          <p class="text-[11.5px] text-faint">seu chefe de gabinete · coordena os donos</p>
        </div>
        <app-meeting-import />
        <button type="button" class="btn btn-ghost !p-2" (click)="history.set(!history())" title="Conversas anteriores" aria-label="Conversas anteriores" [class.!bg-raise]="history()"><app-icon name="summary" [size]="16" /></button>
        <button type="button" class="btn btn-ghost !p-2" (click)="fresh()" title="Nova conversa" aria-label="Nova conversa"><app-icon name="plus" [size]="16" /></button>
      </header>
      @if (history()) {
        <ul class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Conversas anteriores">
          @for (c of chat.chiefChats(); track c.id) {
            <li><button type="button" class="w-full rounded-xl px-3 py-2.5 text-left hover:bg-raise" [class.bg-raise]="c.id === chat.chief.current()" (click)="pick(c.id)">
              <span class="block truncate">{{ c.title }}</span><span class="text-[12px] text-faint">{{ c.updatedAt | ago }}</span></button></li>
          } @empty { <li class="p-6 text-center text-mute">Nenhuma conversa ainda.</li> }
        </ul>
      } @else {
        <app-chat-view class="min-h-0 flex-1" [compact]="true" [session]="chat.chief" />
      }
    </aside>`,
})
export class CockpitPage {
  protected readonly cockpit = inject(CockpitService);
  protected readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);
  private readonly runs = inject(RunsService);
  protected readonly layout = inject(LayoutService);

  protected readonly date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  protected readonly greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; })();
  protected readonly central = computed(() => this.agents.central());
  protected readonly working = computed(() => this.runs.active().length);
  protected readonly chiefBusy = computed(() => { const id = this.chat.chief.current(); return !!id && this.chat.busy().has(id); });
  protected readonly week = computed(() => {
    const ps = this.cockpit.companies().flatMap(c => c.products);
    return { delivered: ps.reduce((a, p) => a + p.rhythm.delivered, 0), validated: ps.reduce((a, p) => a + p.rhythm.validated, 0), returned: ps.reduce((a, p) => a + p.rhythm.returned, 0) };
  });
  protected readonly history = signal(false);
  /** vivo = tem dono, trabalho andando ou números */
  private alive(p: Instrument): boolean { return !!p.owner || p.storiesOpen > 0 || p.metrics.length > 0 || p.toValidate > 0 || p.activeRuns > 0 || p.alerts.length > 0; }
  /** empresas com produtos vivos, das mais movimentadas para as mais calmas */
  protected readonly live = computed(() => this.cockpit.companies()
    .map(c => ({ ...c, products: c.products.filter(p => this.alive(p)) }))
    .filter(c => c.products.length)
    .sort((a, b) => this.weight(b) - this.weight(a)));
  protected readonly dormant = computed(() => this.cockpit.companies().flatMap(c => c.products).filter(p => !this.alive(p)));
  private weight(c: Company): number {
    return c.products.reduce((w, p) => w + (p.alerts.length ? 100 : 0) + (p.ownerOn ? 10 : 0) + p.activeRuns * 3 + p.toValidate * 5 + p.storiesOpen, 0);
  }

  constructor() {
    this.chat.restoreChief();
    this.cockpit.load();
  }

  protected fresh(): void { this.chat.chief.newChat(this.central()?.id); this.history.set(false); }
  protected pick(id: number): void { this.chat.chief.select(id); this.history.set(false); }
}
