import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { GuidesService } from '../../../../shared/services/guides/guides.service';
import { OwnerState as OwnerInfo } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MarkdownPipe, RefsPipe } from '../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { CockpitService } from '../../services/cockpit/cockpit.service';
import { InstrumentCard } from '../cockpit-page/components/instrument/instrument';
import { OneOnOne } from './components/one-on-one/one-on-one';

const SUGGESTIONS = ['Organize o rumo comigo', 'Repense o time para esse rumo', 'Nova frente: ', 'Como estão os números? O que medir?', 'O que está travando?'];

/**
 * Sala do produto: onde o Gustavo dirige um produto. No centro o 1:1 com o dono (pauta, caminhos em cards, o plano com o
 * que muda na prática); ao lado a conversa com ele; em cima quem é o dono e se ele age sozinho; embaixo os instrumentos
 * e o diário. Os bastidores do produto (backlog, sessões, roadmap) ficam a um clique.
 */
@Component({
  selector: 'app-product-room',
  imports: [AgoPipe, ChatView, Icon, InstrumentCard, MarkdownPipe, OneOnOne, ProjectAvatar, RefsPipe, RouterLink],
  host: { class: 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]' },
  templateUrl: './product-room.html',
})
export class ProductRoom {
  protected readonly projects = inject(ProjectsService);
  protected readonly guides = inject(GuidesService);
  protected readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);
  private readonly cockpit = inject(CockpitService);
  private readonly route = inject(ActivatedRoute);

  protected readonly slug = toSignal(this.route.paramMap.pipe(map(p => p.get('slug')!)), { requireSync: true });
  private readonly query = toSignal(this.route.queryParamMap);
  protected readonly project = computed(() => this.projects.bySlug().get(this.slug()) ?? null);
  protected readonly company = computed(() => { const p = this.project(); return p?.parentSlug ? this.projects.bySlug().get(p.parentSlug) ?? null : null; });
  protected readonly owner = computed(() => this.agents.byId().get(this.project()?.todoAgentId ?? -1) ?? null);
  protected readonly instrument = computed(() => this.cockpit.companies().flatMap(c => c.products).find(p => p.slug === this.slug()) ?? null);
  /** o 1:1 aberto deste produto (ou null) */
  protected readonly guide = computed(() => this.guides.openFor(this.slug(), false, 'dono'));
  protected readonly past = computed(() => this.guides.guides().filter(g => g.kind === 'dono' && g.projectSlug === this.slug() && g.status === 'done').slice(0, 6));
  protected readonly candidates = computed(() => {
    const p = this.project();
    return this.agents.agents().filter(a => !a.builtin && (!a.projectSlug || a.projectSlug === p?.slug || a.projectSlug === p?.parentSlug));
  });

  /** conversa com o dono: a do 1:1 aberto; sem 1:1, a última conversa com ele */
  protected readonly session = this.chat.spawn(null);
  protected readonly talking = computed(() => { const id = this.session.current(); return !!id && this.chat.busy().has(id); });
  protected readonly info = signal<OwnerInfo | null>(null);
  protected readonly focus = signal('');
  protected readonly starting = signal(false);
  protected readonly suggestions = SUGGESTIONS;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chat.release(this.session));
    this.guides.load();
    effect(() => {
      const o = this.owner();
      const chat = this.guide()?.centralChat ?? null;
      untracked(() => {
        if (o) this.session.agentId.set(o.id);
        const fallback = o ? this.chat.chats().find(c => c.agentId === o.id && !c.projectSlug)?.id ?? null : null;
        const want = chat ?? fallback;
        if (this.session.current() !== want) this.session.select(want);
      });
    });
    // "Pedir ao dono" de qualquer lugar chega aqui com o texto
    effect(() => { const t = this.query()?.get('pedir'); if (t?.trim()) untracked(() => this.focus.set(t.trim())); });
    effect(() => { const s = this.slug(); this.project()?.ownerOn; untracked(() => this.projects.owner(s).then(i => this.info.set(i), () => {})); });
  }

  protected add(s: string): void { this.focus.update(v => (v.trim() ? `${v.trimEnd()}\n` : '') + s); }

  protected async start(): Promise<void> {
    this.starting.set(true);
    await this.guides.start(this.slug(), false, this.focus().trim() || null, 'dono');
    this.focus.set('');
    this.starting.set(false);
  }

  protected setOwner(id: string): void { this.projects.setTodoOwner(this.slug(), { agentId: id ? Number(id) : null }).catch(() => {}); }
  protected toggleOwner(): void { const p = this.project(); if (p) this.projects.setOwnerOn(p.slug, !p.ownerOn).catch(() => {}); }
}
