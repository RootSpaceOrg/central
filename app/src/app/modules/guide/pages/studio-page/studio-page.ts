import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon, IconName } from '../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Guide, GuidesService } from '../../../../shared/services/guides/guides.service';

interface Tool {
  id: 'rumo' | 'time' | 'piloto';
  path: string;
  icon: IconName;
  name: string;
  pitch: string;
  /** situação agora (uma linha forte) e detalhes */
  status: string;
  tone: string;
  lines: string[];
  cta: string;
}

/**
 * Estúdio: as ferramentas que organizam o projeto (Rumo, Time e Piloto automático) numa tela de cards, com a situação de
 * cada uma no projeto escolhido na barra lateral. Cada card leva para dentro da ferramenta.
 */
@Component({
  selector: 'app-studio-page',
  imports: [RouterLink, Icon, AgoPipe, MarkdownPipe, ProjectAvatar],
  host: { class: '@container block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-6xl px-6 py-7">
      <header class="flex flex-wrap items-end gap-4">
        <div class="min-w-0 flex-1">
          <h1 class="flex items-center gap-2.5 font-display text-[30px] font-bold tracking-tight"><app-icon name="compass" [size]="28" class="text-frost" />Estúdio{{ project() ? ' · ' + project()!.name : '' }}</h1>
          <p class="mt-1 max-w-3xl text-mute">Onde o projeto se organiza: <b class="text-text">Rumo</b> decide para onde ele vai, <b class="text-text">Time</b> decide quem faz e como,
            e o <b class="text-text">Piloto automático</b> faz os dois sozinho e te mostra só o resultado.</p>
        </div>
      </header>

      @if (!project()) {
        <p class="mt-8 text-mute">Escolha um projeto na lista ao lado (ou aqui).</p>
        <div class="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          @for (p of choices(); track p.slug) {
            <button type="button" (click)="scope.set(p.slug)" class="flex items-center gap-3 rounded-2xl border border-edge bg-panel px-4 py-3 text-left transition hover:border-faint">
              <app-project-avatar [project]="p" [size]="28" /><span class="min-w-0 flex-1 truncate font-semibold">{{ p.name }}</span><app-icon name="chevron" [size]="14" class="text-faint" />
            </button>
          }
        </div>
      } @else {
        <div class="mt-7 grid gap-4 @3xl:grid-cols-3">
          @for (t of tools(); track t.id) {
            <a [routerLink]="t.path" [queryParams]="scope.queryFor(t.path)"
               class="group flex flex-col rounded-3xl border bg-panel px-6 py-6 transition hover:-translate-y-0.5 hover:border-frost/50 hover:shadow-[0_24px_60px_-30px_rgb(127_162_255/0.5)]"
               [class]="t.tone === 'later' ? 'border-later/50' : 'border-edge'">
              <span class="grid size-12 place-items-center rounded-2xl bg-frost/12 text-frost"><app-icon [name]="t.icon" [size]="24" /></span>
              <h2 class="mt-4 font-display text-[21px] font-bold">{{ t.name }}</h2>
              <p class="mt-1 text-[13.5px] text-mute">{{ t.pitch }}</p>
              <p class="mt-4 flex items-center gap-2 text-[13.5px] font-semibold"
                 [class]="t.tone === 'later' ? 'text-later' : t.tone === 'live' ? 'text-yes' : 'text-text'">
                @if (t.tone === 'live' || t.tone === 'later') { <span class="pulse size-2 rounded-full" [class]="t.tone === 'later' ? 'bg-later' : 'bg-yes'"></span> }
                {{ t.status }}</p>
              <ul class="mt-2 flex-1 space-y-1 text-[12.5px] text-mute">
                @for (l of t.lines; track $index) { <li>· {{ l }}</li> }
              </ul>
              <span class="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-frost">{{ t.cta }}<app-icon name="chevron" [size]="13" class="transition-transform group-hover:translate-x-0.5" /></span>
            </a>
          }
        </div>

        @if (history().length) {
          <h2 class="mt-10 font-display text-lg font-semibold">Últimas sessões</h2>
          <div class="mt-3 space-y-2">
            @for (h of history(); track h.id) {
              <details class="rounded-2xl border border-edge bg-panel px-4 py-3">
                <summary class="cursor-pointer font-semibold">{{ h.kind === 'agencia' ? 'Time' : 'Rumo' }} <span class="font-normal text-mute">· {{ h.finishedAt ? (h.finishedAt | ago) : '' }}</span></summary>
                <div class="md mt-2 text-[13.5px]" [innerHTML]="(h.minutes ?? 'Sem ata.') | markdown"></div>
              </details>
            }
          </div>
        }
      }
    </div>
  `,
})
export class StudioPage {
  protected readonly scope = inject(ScopeService);
  private readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly guides = inject(GuidesService);

  protected readonly project = computed(() => this.scope.project());
  protected readonly choices = computed(() => this.projects.living().filter(p => !p.parentSlug));
  private readonly auto = signal<{ daily: boolean; weekly: boolean } | null>(null);

  constructor() {
    effect(() => {
      const s = this.scope.slug();
      this.auto.set(null);
      if (s) this.guides.routines(s).then(r => this.auto.set(r), () => {});
    });
  }

  private mine(kind: Guide['kind']) {
    const s = this.scope.slug(), d = this.scope.direct();
    const all = this.guides.guides().filter(g => g.kind === kind && g.projectSlug === s && g.direct === d);
    return { open: all.find(g => g.status === 'open') ?? null, last: all.find(g => g.status === 'done') ?? null };
  }

  protected readonly history = computed(() => this.guides.guides()
    .filter(g => g.status === 'done' && g.projectSlug === this.scope.slug()).slice(0, 5));

  private ago(d: Date | null): string {
    if (!d) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    return days <= 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`;
  }

  protected readonly tools = computed<Tool[]>(() => {
    const rumo = this.mine('rumo'), time = this.mine('agencia');
    const pilot = this.scope.slug() ? this.guides.pilotFor(this.scope.slug()!, this.scope.direct()) : null;
    const lastPilot = this.guides.pilots().find(p => p.projectSlug === this.scope.slug() && p.status === 'done');
    const team = this.agents.agents().filter(a => !a.builtin && this.scope.matches(a.projectSlug));
    const au = this.auto();
    const stepName = ['', 'retrato', 'decisões', 'plano', 'em andamento'];
    const session = (g: Guide | null) => (g ? `Sessão aberta: ${stepName[g.step]}${g.phase !== 'idle' ? ' (agentes falando)' : ''}` : null);
    return [
      {
        id: 'rumo', path: '/estudio/rumo', icon: 'compass', name: 'Rumo', cta: rumo.open ? 'Continuar a sessão' : 'Para onde vamos agora?',
        pitch: 'O estrategista lê o projeto e abre o debate; você decide o rumo, o roadmap e o que priorizar ou cortar.',
        status: session(rumo.open) ?? (rumo.last ? `Última sessão ${this.ago(rumo.last.finishedAt)}` : 'Nenhuma sessão ainda'),
        tone: rumo.open ? (rumo.open.phase !== 'idle' ? 'live' : 'later') : 'idle',
        lines: [
          ...(rumo.last?.minutes ? [rumo.last.minutes.replace(/[#*_`>]/g, '').split('\n').find(l => l.trim().length > 20)?.trim().slice(0, 110) ?? ''] : []),
          ...(rumo.open?.focus ? [`Foco: ${rumo.open.focus.slice(0, 90)}`] : []),
        ].filter(Boolean),
      },
      {
        id: 'time', path: '/estudio/time', icon: 'users', name: 'Time', cta: time.open ? 'Continuar a sessão' : 'O time dá conta?',
        pitch: 'O diretor de agência olha quem faz o quê, os quadros e as rotinas; você decide o time do projeto.',
        status: session(time.open) ?? `${team.length} ${team.length === 1 ? 'agente' : 'agentes'} no projeto`,
        tone: time.open ? (time.open.phase !== 'idle' ? 'live' : 'later') : 'idle',
        lines: [
          team.slice(0, 4).map(a => a.name).join(', ') + (team.length > 4 ? '…' : ''),
          au ? `Revisão automática: ${au.daily || au.weekly ? [au.daily ? 'diária' : '', au.weekly ? 'semanal' : ''].filter(Boolean).join(' + ') : 'desligada'}` : '',
          time.last ? `Última sessão ${this.ago(time.last.finishedAt)}` : '',
        ].filter(Boolean),
      },
      {
        id: 'piloto', path: '/estudio/piloto', icon: 'spark', name: 'Piloto automático', cta: pilot?.status === 'ready' ? 'Ver e dar o ok' : pilot ? 'Acompanhar' : 'Rodar agora',
        pitch: 'Rumo e Time sozinhos: aceita as recomendações, monta o time para o rumo e te mostra só o final para o ok.',
        status: !pilot ? (lastPilot ? `Último ${this.ago(lastPilot.finishedAt)}` : 'Pronto para rodar')
          : pilot.status === 'ready' ? 'Esperando o seu ok' : pilot.status === 'approved' ? 'Executando o que você aprovou'
          : pilot.status === 'failed' ? 'Parou com erro' : pilot.stage === 'time' ? 'Montando o time…' : 'Decidindo o rumo…',
        tone: pilot?.status === 'ready' || pilot?.status === 'failed' ? 'later' : pilot ? 'live' : 'idle',
        lines: [
          'Só roda quando você pede',
          ...(pilot?.focus ? [`Foco: ${pilot.focus.slice(0, 90)}`] : []),
        ],
      },
    ];
  });
}
