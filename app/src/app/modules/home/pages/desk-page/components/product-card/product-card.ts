import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';
import { Metric, ProjectPulse } from '../../../../services/pulse/pulse.service';

/** Um produto em uma olhada: para onde vai (foco do rumo), quem cuida (o dono), o que está andando e os números. */
@Component({
  selector: 'app-product-card',
  imports: [AgoPipe, Icon, ProjectAvatar, RouterLink],
  template: `
    @let p = pulse();
    <article class="flex h-full flex-col rounded-3xl border border-edge bg-panel p-5 transition hover:border-faint">
      <header class="flex items-start gap-3">
        @if (project(); as pr) { <app-project-avatar [project]="pr" [size]="34" /> }
        <div class="min-w-0 flex-1">
          <a [routerLink]="['/projetos', p.slug]" [queryParams]="{ aba: 'dono' }" class="block truncate font-display text-[17px] font-semibold hover:underline">{{ p.name }}</a>
          <p class="text-[12.5px]" [class]="on() ? 'text-yes' : 'text-faint'">
            @if (p.owner) {
              {{ p.owner }} · {{ on() ? (p.lastPassAt ? 'passou ' + (p.lastPassAt | ago) : 'cuidando') : 'parado' }}
            } @else { sem dono }
          </p>
        </div>
        @if (p.owner) {
          <button type="button" role="switch" [attr.aria-checked]="on()" (click)="toggle()"
                  [title]="on() ? 'O dono age sozinho pelos eventos. Clique para pausar.' : 'Ligar: o dono passa a agir sozinho dentro do rumo.'"
                  class="relative mt-1 h-5 w-9 shrink-0 rounded-full transition-colors" [class]="on() ? 'bg-yes' : 'bg-edge'">
            <span class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform" [class.translate-x-4]="on()"></span>
          </button>
        }
      </header>

      @if (p.focus) {
        <p class="mt-4 line-clamp-2 text-[14px] leading-snug"><span class="text-faint">Foco:</span> {{ p.focus }}</p>
      } @else {
        <a routerLink="/estudio/rumo" class="mt-4 text-[13.5px] text-later hover:underline">Sem rumo escrito: definir com o estrategista</a>
      }

      <p class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-mute">
        <span><b class="tabular-nums text-text">{{ p.storiesOpen }}</b> {{ p.storiesOpen === 1 ? 'história andando' : 'histórias andando' }}</span>
        @if (p.toValidate) { <span class="font-semibold text-frost">{{ p.toValidate }} para você usar</span> }
        @if (p.validated) { <span class="text-yes">{{ p.validated }} validada{{ p.validated === 1 ? '' : 's' }} na semana</span> }
      </p>

      @if (p.metrics.length) {
        <div class="mt-3 grid grid-cols-2 gap-1.5">
          @for (m of p.metrics; track m.name) {
            <div class="rounded-xl bg-night/50 px-3 py-2" [title]="(m.note ?? '') + ' · medido ' + (m.at | ago)">
              <p class="truncate text-[11px] text-faint">{{ m.name }}</p>
              <p class="flex items-baseline gap-1 text-[17px] font-semibold tabular-nums">{{ fmt(m.value) }}<span class="text-[11px] font-normal text-mute">{{ m.unit }}</span>
                @if (trend(m); as t) { <span class="text-[11px]" [class]="t > 0 ? 'text-yes' : 'text-later'">{{ t > 0 ? '▲' : '▼' }}</span> }</p>
            </div>
          }
        </div>
      }

      <span class="flex-1"></span>
      @if (p.diary) {
        <a [routerLink]="['/projetos', p.slug]" [queryParams]="{ aba: 'dono' }" class="mt-4 flex gap-2 rounded-xl bg-night/40 px-3 py-2.5 text-[12.5px] leading-snug text-mute hover:text-text">
          <app-icon name="agent" [size]="14" class="mt-0.5 shrink-0 text-faint" /><span class="line-clamp-2">{{ p.diary }}</span></a>
      }
    </article>`,
})
export class ProductCard {
  private readonly projects = inject(ProjectsService);
  readonly pulse = input.required<ProjectPulse>();
  protected readonly project = computed(() => this.projects.bySlug().get(this.pulse().slug) ?? null);
  /** ligado agora (a chave muda na hora, antes de os números recarregarem) */
  protected readonly on = computed(() => this.project()?.ownerOn ?? this.pulse().ownerOn);

  protected toggle(): void { this.projects.setOwnerOn(this.pulse().slug, !this.on()).catch(() => {}); }
  protected fmt(v: number): string { return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
  protected trend(m: Metric): number { return m.prev === null || m.prev === m.value ? 0 : m.value > m.prev ? 1 : -1; }
}
