import { Component, computed, inject, input, signal } from '@angular/core';

import { Guide, GuideCard, GuidePlanItem, GuidesService } from '../../../../../../shared/services/guides/guides.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon, IconName } from '../../../../../../shared/ui/icon';
import { MarkdownPipe, RefsPipe } from '../../../../../../shared/ui/markdown';

const CARD_KIND: Record<string, string> = { rumo: 'Rumo', direcao: 'Caminho', prioridade: 'Prioridade', time: 'Time', fluxo: 'Fluxo', rotina: 'Rotina' };
const ITEM: Record<string, { label: string; icon: IconName }> = {
  historia: { label: 'história', icon: 'kanban' }, tarefa: { label: 'tarefa', icon: 'kanban' }, rumo: { label: 'rumo', icon: 'compass' },
  marco: { label: 'marco', icon: 'flag' }, cortar: { label: 'cortar', icon: 'close' }, metrica: { label: 'número', icon: 'activity' },
  ideia: { label: 'ideia', icon: 'ideas' }, agente: { label: 'agente', icon: 'agent' }, criar_agente: { label: 'novo no time', icon: 'agent' },
  ajustar_agente: { label: 'ajuste no time', icon: 'agent' }, aposentar_agente: { label: 'sai do time', icon: 'agent' },
  quadro: { label: 'fluxo', icon: 'workflow' }, rotina: { label: 'rotina', icon: 'routine' }, dono_todo: { label: 'dono', icon: 'agent' }, agencia: { label: 'time', icon: 'agent' },
};
const WHEN: { id: GuidePlanItem['when']; label: string; hint: string }[] = [
  { id: 'agora', label: 'Agora', hint: 'começa já' }, { id: 'backlog', label: 'Na fila', hint: 'pronto para o time pegar' }, { id: 'depois', label: 'Depois', hint: 'marco ou ideia' },
];

/**
 * O 1:1 aberto: os caminhos que o dono propôs (cards), o plano com o que muda na prática (agrupado por quando), a
 * aprovação e o acompanhamento até a ata. A conversa com o dono fica ao lado.
 */
@Component({
  selector: 'app-one-on-one',
  imports: [AgoPipe, Icon, MarkdownPipe, RefsPipe],
  template: `
    @let g = guide();
    <!-- etapas -->
    <ol class="flex flex-wrap items-center gap-2 text-[12px]" aria-label="Etapas do 1:1">
      @for (s of steps(); track s.n) {
        <li class="flex items-center gap-2">
          <span class="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold" [class]="s.on ? 'bg-[#B48CFF]/15 text-[#C6A6FF]' : s.done ? 'text-yes' : 'text-faint'">
            @if (s.done) { <app-icon name="check" [size]="12" /> } {{ s.label }}</span>
          @if (!$last) { <span class="h-px w-5 bg-edge"></span> }
        </li>
      }
      <span class="flex-1"></span>
      @if (g.status === 'open' && g.step < 4) { <button type="button" class="text-[12px] text-faint hover:text-no" (click)="end()">encerrar sem plano</button> }
    </ol>

    @if (g.reading) {
      <div class="md mt-5 rounded-2xl border border-edge bg-night/40 px-5 py-4 text-[14px] leading-relaxed selectable" [innerHTML]="g.reading | refs | markdown"></div>
    }

    <!-- caminhos -->
    @if (g.step < 4) {
      @if (g.cards.length) {
        <section class="mt-6" aria-labelledby="oo-cards">
          <div class="flex items-baseline gap-3">
            <h3 id="oo-cards" class="font-display text-[19px] font-semibold">Caminhos</h3>
            <span class="text-[12.5px] text-faint">escolha em cada um; pode comentar e pedir outros na conversa</span>
          </div>
          <div class="mt-3 space-y-3">
            @for (c of g.cards; track c.id) {
              <article class="rounded-2xl border bg-panel p-5 transition" [class]="c.answer ? 'border-[#B48CFF]/50' : 'border-edge'">
                <p class="text-[11px] font-bold uppercase tracking-wider text-[#C6A6FF]">{{ kind(c.kind) }}</p>
                <h4 class="mt-1 text-[16px] font-semibold leading-snug">{{ c.question }}</h4>
                @if (c.context) { <p class="mt-1 text-[13.5px] leading-snug text-mute">{{ c.context }}</p> }
                <div class="mt-3 grid gap-2" [class.sm:grid-cols-2]="c.options.length > 1">
                  @for (o of c.options; track $index) {
                    <button type="button" (click)="pick(c, $index)" [attr.aria-pressed]="c.answer?.choice === $index"
                            class="relative rounded-xl border-2 px-4 py-3 text-left transition"
                            [class]="c.answer?.choice === $index ? 'border-[#B48CFF] bg-[#B48CFF]/10' : 'border-edge hover:border-faint'">
                      <span class="flex items-center gap-2 font-semibold">{{ o.label }}
                        @if (c.recommended === $index) { <span class="rounded-full bg-yes/15 px-2 py-0.5 text-[10.5px] font-bold text-yes">o dono recomenda</span> }</span>
                      @if (o.detail) { <span class="mt-1 block text-[12.5px] leading-snug text-mute">{{ o.detail }}</span> }
                    </button>
                  }
                </div>
                @if (c.central || c.strategist) {
                  <div class="mt-3 space-y-1 text-[12.5px] text-mute">
                    @if (c.central) { <p><span class="font-semibold text-text">Dono:</span> {{ c.central }}</p> }
                    @if (c.strategist) { <p><span class="font-semibold text-text">Estrategista:</span> {{ c.strategist }}</p> }
                  </div>
                }
                <input class="field mt-3 text-[13px]" placeholder="Algo a acrescentar? (vai junto da sua escolha)" [value]="c.answer?.note ?? ''"
                       (change)="note(c, $any($event.target).value)" aria-label="Comentário sobre o card" />
              </article>
            }
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" class="btn" [disabled]="asking()" (click)="askStrategist()" title="O estrategista lê a conversa e os cards e dá a opinião dele">
              <app-icon name="compass" [size]="14" />Ouvir o estrategista</button>
            <span class="flex-1"></span>
            @if (answered()) { <span class="text-[12.5px] text-mute">{{ answered() }} de {{ g.cards.length }} respondidos</span> }
            <button type="button" class="btn btn-primary" [disabled]="!answered() || busy()" (click)="plan()">
              {{ g.plan.length ? 'Refazer o plano' : 'Montar o plano' }}<app-icon name="arrowRight" [size]="14" /></button>
          </div>
        </section>
      } @else if (g.status === 'open') {
        <div class="mt-6 rounded-2xl border border-dashed border-edge px-6 py-8 text-center text-[13.5px] text-mute">
          @if (busy()) { <p class="flex items-center justify-center gap-2"><span class="pulse size-2 rounded-full bg-[#B48CFF]"></span>O dono está preparando a pauta…</p> }
          @else { Peça algo na conversa ("organize o rumo", "nova frente: …", "repense o time"): os caminhos aparecem aqui como cards. }
        </div>
      }
    }

    <!-- o plano: o que muda na prática -->
    @if (g.plan.length) {
      <section class="mt-8" aria-labelledby="oo-plan">
        <div class="flex items-baseline gap-3">
          <h3 id="oo-plan" class="font-display text-[19px] font-semibold">O que vai ser feito, na prática</h3>
          @if (g.step < 4) { <span class="text-[12.5px] text-faint">tire o que não quiser e escolha o quando</span> }
        </div>
        @for (w of whens; track w.id) {
          @let items = byWhen(w.id);
          @if (items.length) {
            <p class="mt-4 text-[11px] font-bold uppercase tracking-wider text-faint">{{ w.label }} <span class="font-normal normal-case tracking-normal">· {{ w.hint }}</span></p>
            <ul class="mt-2 space-y-2">
              @for (i of items; track i.id) {
                <li class="flex gap-3 rounded-2xl border bg-panel px-4 py-3 transition" [class]="i.include ? 'border-edge' : 'border-edge/50 opacity-50'">
                  <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-night text-mute"><app-icon [name]="item(i.kind).icon" [size]="15" /></span>
                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold leading-snug" [class.line-through]="!i.include">{{ i.title }}</span>
                      <span class="rounded-full bg-raise px-2 py-0.5 text-[10.5px] text-mute">{{ item(i.kind).label }}</span>
                      @if (i.agent) { <span class="text-[11.5px] text-faint">· {{ i.agent }}</span> }
                    </p>
                    @if (i.why) { <p class="mt-0.5 text-[12.5px] text-mute"><span class="text-faint">por quê:</span> {{ i.why }}</p> }
                    @if (i.detail) { <p class="mt-0.5 text-[12.5px] text-faint">{{ i.detail }}</p> }
                  </div>
                  @if (g.step < 4) {
                    <div class="flex shrink-0 flex-col items-end gap-1.5">
                      <select class="field !w-auto !py-1 text-[12px]" [value]="i.when" (change)="when(i, $any($event.target).value)" aria-label="Quando">
                        @for (x of whens; track x.id) { <option [value]="x.id">{{ x.label }}</option> }
                      </select>
                      <button type="button" class="text-[11.5px]" [class]="i.include ? 'text-faint hover:text-no' : 'text-frost'" (click)="toggle(i)">{{ i.include ? 'tirar' : 'manter' }}</button>
                    </div>
                  }
                </li>
              }
            </ul>
          }
        }
        @if (g.step < 4) {
          <div class="mt-5 flex items-center gap-3 rounded-2xl border border-yes/30 bg-yes/[0.05] px-5 py-4">
            <p class="min-w-0 flex-1 text-[13.5px]"><b>{{ included() }}</b> {{ included() === 1 ? 'item' : 'itens' }} · o dono executa e o time começa; você acompanha no cockpit.</p>
            <button type="button" class="btn !border-yes !bg-yes px-5 !text-night" [disabled]="!included() || busy()" (click)="approve()"><app-icon name="check" [size]="15" />Aprovar</button>
          </div>
        }
      </section>
    }

    @if (g.step === 4) {
      <section class="mt-8 rounded-2xl border border-edge bg-panel px-5 py-4" aria-labelledby="oo-run">
        <h3 id="oo-run" class="flex items-center gap-2 font-semibold">
          @if (g.status === 'done') { <app-icon name="check" [size]="16" class="text-yes" />Feito } @else { <span class="pulse size-2 rounded-full bg-yes"></span>O dono está executando }
        </h3>
        @if (g.minutes) { <div class="md mt-2 text-[14px] leading-relaxed selectable" [innerHTML]="g.minutes | refs | markdown"></div> }
        @else { <p class="mt-1 text-[13px] text-mute">Ele cria as histórias, ajusta o time e os números e fecha com a ata aqui. Pode acompanhar na conversa ao lado.</p> }
      </section>
    }`,
})
export class OneOnOne {
  private readonly guides = inject(GuidesService);
  readonly guide = input.required<Guide>();
  /** o dono está falando (conversa ocupada) */
  readonly busy = input(false);
  protected readonly whens = WHEN;
  protected readonly asking = signal(false);

  protected readonly answered = computed(() => this.guide().cards.filter(c => c.answer).length);
  protected readonly included = computed(() => this.guide().plan.filter(i => i.include).length);
  protected readonly steps = computed(() => {
    const g = this.guide();
    const at = g.step >= 4 ? 4 : g.plan.length ? 3 : g.cards.length ? 2 : 1;
    return [{ n: 1, label: 'Pauta' }, { n: 2, label: 'Caminhos' }, { n: 3, label: 'Plano' }, { n: 4, label: g.status === 'done' ? 'Feito' : 'Executando' }]
      .map(s => ({ ...s, on: s.n === at, done: s.n < at || (s.n === 4 && g.status === 'done') }));
  });

  protected kind(k: string): string { return CARD_KIND[k] ?? k; }
  protected item(k: string) { return ITEM[k] ?? { label: k, icon: 'kanban' as IconName }; }
  protected byWhen(w: GuidePlanItem['when']) { return this.guide().plan.filter(i => i.when === w); }

  protected pick(c: GuideCard, i: number): void { this.guides.answer(this.guide().id, c.id, { choice: c.answer?.choice === i ? null : i, note: c.answer?.note ?? '' }); }
  protected note(c: GuideCard, text: string): void { this.guides.answer(this.guide().id, c.id, { choice: c.answer?.choice ?? null, note: text.trim() }); }
  protected when(i: GuidePlanItem, w: GuidePlanItem['when']): void { this.guides.item(this.guide().id, i.id, { when: w }); }
  protected toggle(i: GuidePlanItem): void { this.guides.item(this.guide().id, i.id, { include: !i.include }); }
  protected plan(): void { this.guides.requestPlan(this.guide().id); }
  protected approve(): void { this.guides.approve(this.guide().id); }
  protected end(): void { this.guides.abandon(this.guide().id); }
  protected async askStrategist(): Promise<void> {
    this.asking.set(true);
    await this.guides.ask(this.guide().id, '');
    this.asking.set(false);
  }
}
