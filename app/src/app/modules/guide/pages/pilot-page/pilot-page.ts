import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MarkdownPipe, RefsPipe } from '../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Guide, GuidePlanItem, GuidesService, Pilot } from '../../../../shared/services/guides/guides.service';

const KIND: Record<string, string> = {
  rumo: 'rumo', marco: 'marco', tarefa: 'tarefa', ideia: 'ideia', cortar: 'cortar', agente: 'agente', agencia: 'para o Time',
  criar_agente: 'novo agente', ajustar_agente: 'ajustar agente', aposentar_agente: 'aposentar', quadro: 'quadro', rotina: 'rotina', dono_todo: 'dono do A fazer',
};
const CARD_KIND: Record<string, string> = {
  rumo: 'Rumo e roadmap', direcao: 'Direção', prioridade: 'Priorizar e cortar', time: 'Time', fluxo: 'Fluxo (quadros)', rotina: 'Rotinas',
};
const TONE: Record<string, string> = {
  rumo: 'bg-[#C8A2FF]/15 text-[#C8A2FF]', marco: 'bg-later/15 text-later', tarefa: 'bg-frost/15 text-frost', ideia: 'bg-yes/15 text-yes',
  cortar: 'bg-no/15 text-no', agente: 'bg-frost/15 text-frost', agencia: 'bg-[#7ED6C2]/15 text-[#7ED6C2]', criar_agente: 'bg-yes/15 text-yes',
  ajustar_agente: 'bg-frost/15 text-frost', aposentar_agente: 'bg-no/15 text-no', quadro: 'bg-[#C6A6FF]/15 text-[#C6A6FF]', rotina: 'bg-later/15 text-later',
  dono_todo: 'bg-frost/15 text-frost',
};
const SUGGESTIONS = ['Quero um time enxuto', 'O que devemos cortar?', 'Estamos prontos para ir para produção?', 'Foco em vender mais', 'Fechar o legado antes de coisa nova'];

type Step = 1 | 2 | 3 | 4;

/**
 * Estúdio → Piloto automático, no mesmo formato do Rumo e do Time: etapas no centro (Rumo → Time → Seu ok → Em andamento)
 * e o debate à direita (a conversa do Rumo ou do Time). Roda o Rumo pelas recomendações, monta o Time para esse rumo e
 * para no fim para o seu ok (ou feedback, que refaz a partir do Rumo).
 */
@Component({
  selector: 'app-pilot-page',
  imports: [NgTemplateOutlet, RouterLink, Icon, AgoPipe, MarkdownPipe, RefsPipe, ProjectAvatar, ChatView],
  host: { class: '@container block h-full' },
  templateUrl: './pilot-page.html',
})
export class PilotPage {
  protected readonly scope = inject(ScopeService);
  protected readonly guides = inject(GuidesService);
  private readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);

  protected readonly kindLabel = KIND;
  protected readonly cardKind = CARD_KIND;
  protected readonly tone = TONE;
  protected readonly suggestions = SUGGESTIONS;
  protected readonly focus = signal('');
  protected readonly feedback = signal('');
  protected readonly busy = signal(false);

  protected readonly project = computed(() => this.scope.project());
  protected readonly choices = computed(() => this.projects.living().filter(p => !p.parentSlug));
  protected readonly pilot = computed(() => (this.scope.slug() ? this.guides.pilotFor(this.scope.slug()!, this.scope.direct()) : null));
  protected readonly last = computed(() => this.guides.pilots().find(p => p.projectSlug === this.scope.slug() && p.status === 'done') ?? null);
  protected readonly rumo = computed(() => this.guides.guide(this.pilot()?.rumoGuide ?? null));
  protected readonly time = computed(() => this.guides.guide(this.pilot()?.timeGuide ?? null));

  /** etapa em que o piloto está (e até onde dá para olhar) */
  protected readonly current = computed<Step>(() => {
    const p = this.pilot();
    if (!p) return 1;
    return p.status === 'approved' ? 4 : p.status === 'ready' ? 3 : p.stage === 'time' ? 2 : 1;
  });
  /** etapa aberta (você pode voltar para olhar uma anterior) */
  private readonly picked = signal<Step | null>(null);
  protected readonly step = computed<Step>(() => Math.min(this.picked() ?? this.current(), this.current()) as Step);
  protected readonly steps = [
    { n: 1 as Step, label: 'Rumo' }, { n: 2 as Step, label: 'Time' }, { n: 3 as Step, label: 'Seu ok' }, { n: 4 as Step, label: 'Em andamento' },
  ];
  protected go(n: Step): void { if (n <= this.current()) this.picked.set(n); }

  // ---------- debate à direita: a conversa do Rumo ou do Time ----------
  protected readonly side = signal<'rumo' | 'time'>('rumo');
  protected readonly sideGuide = computed(() => (this.side() === 'time' ? this.time() : this.rumo()));
  protected readonly session = this.chat.spawn(null);
  protected readonly specialistBusy = computed(() => { const g = this.sideGuide(); return !!g?.strategistChat && this.chat.busy().has(g.strategistChat); });
  protected readonly centralBusy = computed(() => { const g = this.sideGuide(); return !!g?.centralChat && this.chat.busy().has(g.centralChat); });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chat.release(this.session));
    // o debate acompanha a etapa (Time a partir da 2), mas você pode trocar
    effect(() => { const c = this.current(); untracked(() => this.side.set(c >= 2 && this.time() ? 'time' : 'rumo')); });
    effect(() => {
      const id = this.sideGuide()?.centralChat ?? null;
      const central = this.agents.central();
      untracked(() => {
        if (central) this.session.agentId.set(central.id);
        if (this.session.current() !== id) this.session.select(id);
      });
    });
  }

  /** o que está acontecendo na sessão (Rumo ou Time) */
  protected status(g: Guide | null, who: string): string {
    if (!g) return 'esperando o Rumo';
    if (g.plan.length) return 'plano pronto';
    if (g.cards.length) return g.phase !== 'idle' ? 'a Central está montando o plano…' : 'escolhendo pelas recomendações…';
    return g.phase === 'analysis' ? `o ${who} está lendo o projeto…` : 'a Central está respondendo e montando as decisões…';
  }

  protected chosen(g: Guide | null) {
    return (g?.cards ?? []).map(c => ({
      kind: c.kind, q: c.question, context: c.context,
      a: c.answer?.choice != null ? c.options[c.answer.choice]?.label : c.answer?.note || '—',
      detail: c.answer?.choice != null ? c.options[c.answer.choice]?.detail : null,
      strategist: c.strategist, central: c.central,
    }));
  }
  protected columns(g: Guide | null) {
    const inc = (g?.plan ?? []).filter(p => p.include);
    return [
      { id: 'agora', label: 'Agora', tone: 'text-yes', items: inc.filter(p => p.when === 'agora') },
      { id: 'backlog', label: 'Backlog', tone: 'text-frost', items: inc.filter(p => p.when === 'backlog') },
      { id: 'depois', label: 'Depois', tone: 'text-mute', items: inc.filter(p => p.when === 'depois') },
    ];
  }
  /** revisão final: o que cada item faz, agrupado por quando acontece, com o porquê */
  private readonly ACTION: Record<string, string> = {
    rumo: 'Ajusta o rumo', marco: 'Roadmap', tarefa: 'Tarefa', ideia: 'Ideia', cortar: 'Corta', agente: 'Agente trabalha', agencia: 'Vai para o Time',
    criar_agente: 'Agente novo', ajustar_agente: 'Ajusta agente', aposentar_agente: 'Aposenta agente', quadro: 'Quadro', rotina: 'Rotina', dono_todo: 'Dono do A fazer',
  };
  protected review(g: Guide | null, part: 'rumo' | 'time') {
    const when = part === 'rumo'
      ? { agora: ['Começa já', 'um agente pega na hora'], backlog: ['Vai para o A fazer', 'vira tarefa com dono, na fila'], depois: ['Fica anotado', 'vira marco ou ideia para depois'] }
      : { agora: ['Aplicado já', 'a Central cria ou muda na hora'], backlog: ['Vira tarefa', 'para fazer depois, com dono'], depois: ['Fica anotado', 'vira ideia'] };
    const inc = (g?.plan ?? []).filter(p => p.include);
    return (['agora', 'backlog', 'depois'] as const).map(w => ({
      id: w, title: when[w][0], hint: when[w][1],
      items: inc.filter(p => p.when === w).map(p => ({ ...p, action: this.ACTION[p.kind] ?? p.kind, reason: p.why || (p.detail ? p.detail.split('\n')[0].slice(0, 180) : null) })),
    })).filter(x => x.items.length);
  }
  /** a frase de cima: quanto muda ao dar ok */
  protected readonly summary = computed(() => {
    const items = [...(this.rumo()?.plan ?? []), ...(this.time()?.plan ?? [])].filter(p => p.include);
    const n = (kinds: string[]) => items.filter(p => kinds.includes(p.kind)).length;
    const parts = [
      [n(['rumo', 'marco']), 'mudança no rumo/roadmap', 'mudanças no rumo/roadmap'],
      [n(['tarefa', 'agente']), 'tarefa', 'tarefas'],
      [n(['criar_agente']), 'agente novo', 'agentes novos'],
      [n(['ajustar_agente', 'dono_todo']), 'ajuste no time', 'ajustes no time'],
      [n(['aposentar_agente']), 'agente aposentado', 'agentes aposentados'],
      [n(['quadro', 'rotina']), 'quadro/rotina', 'quadros/rotinas'],
      [n(['cortar']), 'corte', 'cortes'],
      [n(['ideia']), 'ideia para depois', 'ideias para depois'],
    ] as [number, string, string][];
    return { total: items.length, parts: parts.filter(([k]) => k > 0).map(([k, one, many]) => `${k} ${k === 1 ? one : many}`) };
  });

  protected count(g: Guide | null): number { return (g?.plan ?? []).filter((p: GuidePlanItem) => p.include).length; }

  protected addSuggestion(s: string): void { this.focus.update(v => (v.trim() ? `${v.trimEnd()}\n` : '') + s); }
  protected async start(): Promise<void> {
    const s = this.scope.slug();
    if (!s) return;
    this.busy.set(true);
    await this.guides.pilotStart(s, this.scope.direct(), this.focus().trim() || null);
    this.focus.set('');
    this.picked.set(null);
    this.busy.set(false);
  }
  protected async approve(p: Pilot): Promise<void> { this.busy.set(true); await this.guides.pilotApprove(p.id); this.busy.set(false); }
  protected async sendFeedback(p: Pilot): Promise<void> {
    const t = this.feedback().trim();
    if (!t) return;
    this.busy.set(true);
    const ok = await this.guides.pilotFeedback(p.id, t);
    this.busy.set(false);
    if (ok !== null) { this.feedback.set(''); this.picked.set(null); }
  }
  protected abandon(p: Pilot): void { if (confirm('Parar o piloto automático? As sessões de Rumo e Time ficam abertas para você continuar à mão.')) this.guides.pilotAbandon(p.id); }
}
