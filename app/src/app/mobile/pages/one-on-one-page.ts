import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChatService } from '../../shared/services/chat/chat.service';
import { GuidesService } from '../../shared/services/guides/guides.service';
import { Icon } from '../../shared/ui/icon';
import { OneOnOne } from '../../modules/cockpit/pages/product-room/components/one-on-one/one-on-one';

/** 1:1 no celular: as rodadas de perguntas, o "o que o dono entendeu" e o plano (o mesmo componente do PC) */
@Component({
  selector: 'app-mobile-one-on-one',
  imports: [Icon, OneOnOne, RouterLink],
  host: { class: 'block px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8' },
  template: `
    <a routerLink="/para-voce" class="flex items-center gap-1 text-[13px] text-mute"><app-icon name="back" [size]="14" />Para você</a>
    @if (guide(); as g) {
      <h1 class="mt-2 font-display text-[22px] font-bold">1:1</h1>
      <app-one-on-one class="mt-3 block" [guide]="g" [busy]="busy()" />
    } @else { <p class="mt-10 text-center text-mute">Esse 1:1 já fechou.</p> }`,
})
export class OneOnOnePage {
  readonly id = input.required<string>();
  private readonly guides = inject(GuidesService);
  private readonly chat = inject(ChatService);
  protected readonly guide = computed(() => this.guides.guides().find(g => g.id === Number(this.id())) ?? null);
  protected readonly busy = computed(() => { const c = this.guide()?.centralChat; return !!c && this.chat.busy().has(c); });
  constructor() { this.guides.load(); }
}
