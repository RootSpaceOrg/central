import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Delivery, DeliveriesService } from '../../shared/services/deliveries/deliveries.service';
import { GuidesService } from '../../shared/services/guides/guides.service';
import { IpcService } from '../../shared/services/ipc/ipc.service';
import { Proposal } from '../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../shared/services/proposals/proposals.service';
import { MarkdownPipe } from '../../shared/ui/markdown';
import { VideoPlayer } from '../../shared/ui/video-player';
import { CockpitService } from '../../modules/cockpit/services/cockpit/cockpit.service';
import { MobileScope, ScopePicker } from '../scope';

/**
 * Para você, no celular: o que destrava os agentes. Pedidos de 1:1 e rodadas esperando resposta, decisões (com as
 * opções), entregas para usar (com o vídeo; "Funciona" aprova sem merge, "Não funcionou" devolve com o que faltou).
 */
@Component({
  selector: 'app-mobile-for-you',
  imports: [MarkdownPipe, RouterLink, ScopePicker, VideoPlayer],
  host: { class: 'block px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8' },
  template: `
    <h1 class="font-display text-[24px] font-bold">Para você</h1>
    <div class="my-2"><app-scope-picker /></div>
    <p class="text-[13px] text-mute">{{ total() ? total() + ' coisas esperam você' : 'Nada esperando você agora.' }}</p>

    <!-- 1:1: pedidos e rodadas abertas -->
    @for (g of rounds(); track g.id) {
      <a [routerLink]="['/um-a-um', g.id]" class="mt-4 block rounded-2xl border border-[#B48CFF]/60 bg-[#B48CFF]/[0.09] px-4 py-3">
        <p class="text-[11.5px] font-bold uppercase tracking-wider text-[#C6A6FF]">1:1 · {{ projectName(g.projectSlug) }}</p>
        <p class="mt-0.5 font-semibold leading-snug">{{ g.cards.length ? 'Rodada ' + (g.rounds.length + 1) + ': ' + g.cards.length + ' perguntas' : g.understanding ? 'O dono fechou o entendimento' : g.plan.length ? 'Plano pronto para aprovar' : 'O dono está pensando…' }}</p>
        <p class="mt-1 text-[13px] font-semibold text-[#C6A6FF]">Responder →</p>
      </a>
    }
    @for (r of asked(); track r.slug) {
      <div class="mt-4 rounded-2xl border border-[#B48CFF]/40 bg-[#B48CFF]/[0.05] px-4 py-3">
        <p class="text-[11.5px] font-bold uppercase tracking-wider text-[#C6A6FF]">{{ r.owner }} pediu um 1:1 · {{ r.name }}</p>
        <p class="mt-0.5 text-[14px] leading-snug">{{ r.why }}</p>
        <p class="mt-1 text-[12px] text-faint">Abra o 1:1 no PC (a pauta pede a tela grande).</p>
      </div>
    }

    <!-- decisões -->
    @if (decisions().length) { <h2 class="mt-7 text-[11.5px] font-bold uppercase tracking-wider text-faint">Decisões</h2> }
    @for (p of decisions(); track p.id) {
      <article class="mt-2.5 rounded-2xl border border-edge bg-panel px-4 py-3.5">
        <p class="text-[11.5px] font-bold uppercase tracking-wider text-later">{{ projectName(p.projectSlug) }}</p>
        <h3 class="mt-0.5 font-semibold leading-snug">{{ p.title }}</h3>
        @if (p.summary || p.nextAction) { <p class="mt-1 text-[13.5px] leading-snug text-mute">{{ p.summary || p.nextAction }}</p> }
        <div class="mt-3 flex flex-col gap-2">
          @if (p.options.length) {
            @for (o of p.options; track $index) {
              <button type="button" class="rounded-xl border-2 border-yes/50 px-3 py-2.5 text-left text-[14px] font-semibold text-yes active:bg-yes/10" (click)="choose(p, o)">{{ o }}</button>
            }
          } @else {
            <div class="flex gap-2">
              <button type="button" class="flex-1 rounded-xl bg-yes py-2.5 font-semibold text-night" (click)="proposals.decide(p, 'approve')">Aprovar</button>
              <button type="button" class="flex-1 rounded-xl border-2 border-edge py-2.5 font-semibold text-no" (click)="proposals.decide(p, 'reject')">Não</button>
            </div>
          }
          <div class="flex gap-2 text-[13px]">
            <button type="button" class="flex-1 rounded-xl border border-edge py-2 text-mute" (click)="proposals.decide(p, 'defer')">Depois</button>
            <button type="button" class="flex-1 rounded-xl border border-edge py-2 text-mute" (click)="talk(p)">Conversar com o agente</button>
          </div>
        </div>
      </article>
    }

    <!-- entregas para usar -->
    @if (reviews().length) { <h2 class="mt-7 text-[11.5px] font-bold uppercase tracking-wider text-faint">Use e diga se funciona</h2> }
    @for (d of reviews(); track d.id) {
      <article class="mt-2.5 rounded-2xl border border-edge bg-panel px-4 py-3.5">
        <p class="text-[11.5px] font-bold uppercase tracking-wider text-frost">{{ d.projectName ?? 'geral' }} · {{ d.agentName ?? 'agente' }}</p>
        <h3 class="mt-0.5 font-semibold leading-snug">{{ d.title }}</h3>
        @if (d.video) { <app-video-player class="mt-3" [src]="d.video" [label]="d.title" /> }
        @if (d.howToTest) {
          <details class="mt-3 rounded-xl bg-night/50 px-3 py-2">
            <summary class="text-[13px] font-semibold text-frost">Como testar</summary>
            <div class="md mt-1 text-[13.5px] leading-relaxed" [innerHTML]="d.howToTest | markdown"></div>
          </details>
        }
        @if (adjusting() === d.id) {
          <textarea class="field mt-3 h-24 text-[14px]" placeholder="O que não funcionou?" [value]="note()" (input)="note.set($any($event.target).value)" aria-label="O que não funcionou"></textarea>
          <div class="mt-2 flex gap-2">
            <button type="button" class="flex-1 rounded-xl border border-edge py-2.5 text-mute" (click)="adjusting.set(null)">Cancelar</button>
            <button type="button" class="flex-1 rounded-xl bg-later py-2.5 font-semibold text-night" [disabled]="!note().trim()" (click)="sendAdjust(d)">Devolver</button>
          </div>
        } @else {
          <div class="mt-3 flex gap-2">
            <button type="button" class="flex-1 rounded-xl bg-yes py-2.5 font-semibold text-night" (click)="accept(d)">Funciona</button>
            <button type="button" class="flex-1 rounded-xl border-2 border-edge py-2.5 font-semibold text-later" (click)="adjusting.set(d.id); note.set('')">Não funcionou</button>
          </div>
        }
      </article>
    }
    @if (error(); as e) { <p role="alert" class="mt-4 text-[13px] text-no">{{ e }}</p> }`,
})
export class ForYouPage {
  protected readonly proposals = inject(ProposalsService);
  private readonly deliveries = inject(DeliveriesService);
  private readonly guides = inject(GuidesService);
  private readonly cockpit = inject(CockpitService);
  private readonly ipc = inject(IpcService);
  private readonly router = inject(Router);
  protected readonly adjusting = signal<number | null>(null);
  protected readonly note = signal('');
  protected readonly error = signal<string | null>(null);

  private readonly scope = inject(MobileScope);
  private readonly products = computed(() => this.cockpit.companies().flatMap(c => c.products).filter(p => this.scope.matches(p.slug)));
  protected readonly decisions = computed(() => this.proposals.inbox().filter(p => this.scope.matches(p.projectSlug)));
  protected readonly reviews = computed(() => this.deliveries.board().filter(d => (d.status === 'review' || d.status === 'pending') && this.scope.matches(d.projectSlug)));
  /** 1:1 aberto em que a vez é sua (rodada, entendimento ou plano) */
  protected readonly rounds = computed(() => this.guides.open().filter(g => g.kind === 'dono' && this.scope.matches(g.projectSlug) && (g.cards.length || g.understanding || g.plan.length || g.phase !== 'idle')));
  protected readonly asked = computed(() => this.products().filter(p => p.oneOnOne && !this.rounds().some(g => g.projectSlug === p.slug))
    .map(p => ({ slug: p.slug, name: p.name, owner: p.owner?.name ?? 'O dono', why: p.oneOnOne!.why })));
  protected readonly total = computed(() => this.decisions().length + this.reviews().length + this.rounds().length + this.asked().length);

  constructor() { this.guides.load(); }

  protected projectName(slug: string | null): string { return (slug && this.products().find(p => p.slug === slug)?.name) || 'geral'; }
  protected choose(p: Proposal, o: string): void { this.proposals.decide(p, 'approve', `Escolheu: ${o}`); }
  protected accept(d: Delivery): void { if (confirm(`"${d.title}" funciona? A entrega é aprovada (o merge continua com você no PC).`)) this.deliveries.accept(d); }
  protected async sendAdjust(d: Delivery): Promise<void> {
    try { await this.deliveries.adjust(d, this.note().trim()); this.adjusting.set(null); }
    catch (e) { this.error.set((e as Error).message); }
  }
  protected async talk(p: Proposal): Promise<void> {
    try {
      const r = await this.ipc.invoke('proposals:chat', p.id);
      if (r && 'chat' in r) this.router.navigate(['/conversas', r.chat]);
      else this.error.set('Não achei a conversa do agente que pediu (pode estar trabalhando agora).');
    } catch (e) { this.error.set((e as Error).message); }
  }
}
