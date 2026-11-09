import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MarkdownPipe, RefsPipe } from '../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Guide, GuidePlanItem, GuidesService, Pilot } from '../../services/guides/guides.service';

const KIND: Record<string, string> = {
  rumo: 'rumo', marco: 'marco', tarefa: 'tarefa', ideia: 'ideia', cortar: 'cortar', agente: 'agente', agencia: 'para o Time',
  criar_agente: 'novo agente', ajustar_agente: 'ajustar agente', aposentar_agente: 'aposentar', quadro: 'quadro', rotina: 'rotina', dono_todo: 'dono do A fazer',
};

/**
 * Estúdio → Piloto automático: roda o Rumo aceitando as recomendações, monta o Time a partir dele e para no final para o
 * seu ok (ou feedback, que refaz a partir do Rumo). Com o ok, a Central executa o rumo e depois o time.
 */
@Component({
  selector: 'app-pilot-page',
  imports: [RouterLink, Icon, AgoPipe, MarkdownPipe, RefsPipe, ProjectAvatar],
  host: { class: '@container block h-full overflow-y-auto' },
  templateUrl: './pilot-page.html',
})
export class PilotPage {
  protected readonly scope = inject(ScopeService);
  protected readonly guides = inject(GuidesService);
  private readonly projects = inject(ProjectsService);

  protected readonly kindLabel = KIND;
  protected readonly focus = signal('');
  protected readonly feedback = signal('');
  protected readonly busy = signal(false);

  protected readonly project = computed(() => this.scope.project());
  protected readonly choices = computed(() => this.projects.living().filter(p => !p.parentSlug));
  protected readonly pilot = computed(() => (this.scope.slug() ? this.guides.pilotFor(this.scope.slug()!, this.scope.direct()) : null));
  protected readonly last = computed(() => this.guides.pilots().find(p => p.projectSlug === this.scope.slug() && p.status === 'done') ?? null);
  protected readonly rumo = computed(() => this.guides.guide(this.pilot()?.rumoGuide ?? null));
  protected readonly time = computed(() => this.guides.guide(this.pilot()?.timeGuide ?? null));

  /** linha do tempo enquanto anda */
  protected readonly steps = computed(() => {
    const p = this.pilot(), r = this.rumo(), t = this.time();
    if (!p) return [];
    const state = (g: Guide | null, active: boolean) => !g ? (active ? 'começando…' : 'depois')
      : g.plan.length ? 'plano pronto' : g.cards.length ? 'escolhendo pelas recomendações' : g.phase === 'analysis' ? 'especialista analisando' : 'Central respondendo';
    return [
      { label: 'Rumo', detail: state(r, true), done: !!r?.plan.length && p.stage !== 'rumo', on: p.stage === 'rumo' },
      { label: 'Time', detail: state(t, p.stage === 'time'), done: !!t?.plan.length && p.stage === 'ready', on: p.stage === 'time' },
      { label: 'Seu ok', detail: p.status === 'ready' ? 'esperando você' : 'no fim', done: false, on: p.status === 'ready' },
    ];
  });

  protected picked(g: Guide | null) {
    return (g?.cards ?? []).map(c => ({ q: c.question, a: c.answer?.choice != null ? c.options[c.answer.choice]?.label : c.answer?.note || '—', kind: c.kind }));
  }
  protected plan(g: Guide | null): GuidePlanItem[] { return (g?.plan ?? []).filter(i => i.include); }

  protected async start(): Promise<void> {
    const s = this.scope.slug();
    if (!s) return;
    this.busy.set(true);
    await this.guides.pilotStart(s, this.scope.direct(), this.focus().trim() || null);
    this.focus.set('');
    this.busy.set(false);
  }
  protected async approve(p: Pilot): Promise<void> { this.busy.set(true); await this.guides.pilotApprove(p.id); this.busy.set(false); }
  protected async sendFeedback(p: Pilot): Promise<void> {
    const t = this.feedback().trim();
    if (!t) return;
    this.busy.set(true);
    const ok = await this.guides.pilotFeedback(p.id, t);
    this.busy.set(false);
    if (ok !== null) this.feedback.set('');
  }
  protected abandon(p: Pilot): void { if (confirm('Parar o piloto automático? As sessões de Rumo e Time ficam abertas para você continuar à mão.')) this.guides.pilotAbandon(p.id); }
}
