import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

import { Icon, IconName } from '../shared/ui/icon';

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Início', icon: 'desk' },
  { path: '/projetos', label: 'Projetos', icon: 'layers' },
  { path: '/para-voce', label: 'Para você', icon: 'inbox' },
  { path: '/conversas', label: 'Conversas', icon: 'comments' },
];

/**
 * A Central no celular: só o que se resolve fora do PC. Início (os produtos e quem trabalha), Para você (decisões,
 * entregas para usar e as rodadas do 1:1) e Conversas (falar com os agentes). O resto continua no PC.
 */
@Component({
  selector: 'app-root',
  imports: [Icon, RouterLink, RouterOutlet],
  host: { class: 'flex h-dvh flex-col bg-night text-text' },
  template: `
    <main class="min-h-0 flex-1 overflow-y-auto"><router-outlet /></main>
    @if (!pairing()) {
      <nav class="grid shrink-0 grid-cols-4 border-t border-edge bg-panel pb-[env(safe-area-inset-bottom)]" aria-label="Seções">
        @for (t of tabs; track t.path) {
          @let on = active() === t.path;
          <a [routerLink]="t.path" class="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold" [class]="on ? 'text-frost' : 'text-mute'" [attr.aria-current]="on ? 'page' : null">
            <app-icon [name]="t.icon" [size]="21" [fill]="on" />{{ t.label }}</a>
        }
      </nav>
    }`,
})
export class MobileApp {
  private readonly router = inject(Router);
  protected readonly tabs = TABS;
  private readonly url = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(e => (e as NavigationEnd).urlAfterRedirects)), { initialValue: this.router.url });
  protected readonly active = computed(() => { const u = this.url() || '/'; return TABS.slice().reverse().find(t => t.path === '/' ? u === '/' || u === '' : u.startsWith(t.path))?.path ?? '/'; });
  protected readonly pairing = computed(() => (this.url() || '').startsWith('/parear'));
  readonly ready = signal(true);
}
