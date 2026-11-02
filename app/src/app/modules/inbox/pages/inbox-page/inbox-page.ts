import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { DirectionService } from '../../../../shared/services/direction/direction.service';
import { IDEA_SOURCE_LABEL, Idea, IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { Proposal, RISK_LABEL, SOURCE_LABEL, Verdict } from '../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

const KEYS: Record<string, Verdict> = { a: 'approve', d: 'defer', n: 'reject' };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Item da triagem: decisão (pergunta/alerta de um agente ou do CI) ou ideia nova (sua ou de um agente). */
type Item = { kind: 'decision'; p: Proposal } | { kind: 'idea'; i: Idea };

/**
 * Triagem: o trabalho de gestor num lugar só. Uma coisa de cada vez: decisões primeiro (alguém está esperando),
 * depois ideias novas. Aprovar uma ideia a torna insumo do backlog do projeto; o gestor do projeto quebra em tarefas.
 */
@Component({
  selector: 'app-inbox-page',
  imports: [Icon, RouterLink, ProjectSelect, ProjectAvatar, AgoPipe],
  templateUrl: './inbox-page.html',
  host: { class: 'block h-full overflow-y-auto', '(document:keydown)': 'onKey($event)' },
})
export class InboxPage {
  protected readonly proposals = inject(ProposalsService);
  protected readonly ideas = inject(IdeasService);
  protected readonly projects = inject(ProjectsService);
  protected readonly direction = inject(DirectionService);

  /** ideias deixadas para depois nesta visita (continuam novas, vão para o fim) */
  private readonly skipped = signal<ReadonlySet<number>>(new Set());
  protected readonly queue = computed<Item[]>(() => {
    const ideas = this.ideas.fresh();
    const later = this.skipped();
    return [
      ...this.proposals.inbox().map(p => ({ kind: 'decision' as const, p })),
      ...ideas.filter(i => !later.has(i.id)).map(i => ({ kind: 'idea' as const, i })),
      ...ideas.filter(i => later.has(i.id)).map(i => ({ kind: 'idea' as const, i })),
    ];
  });
  protected readonly current = computed(() => this.queue()[0] ?? null);
  protected readonly behind = computed(() => Math.min(this.queue().length - 1, 2));
  protected readonly leaving = signal<Verdict | null>(null);
  /** projeto escolhido no cartão da ideia (se ela ainda não tem) */
  protected readonly pickSlug = signal('');
  protected readonly error = signal<string | null>(null);

  /** aprovadas que ainda não viraram tarefa, por projeto: o gestor de cada um tem trabalho */
  protected readonly waiting = computed(() => {
    const m = new Map<string, Idea[]>();
    for (const i of this.ideas.waiting()) if (i.projectSlug) m.set(i.projectSlug, [...(m.get(i.projectSlug) ?? []), i]);
    return [...m].map(([slug, list]) => ({ slug, list }));
  });

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly projectSlug = signal('');
  protected readonly risk = RISK_LABEL;
  protected readonly source = (s: string) => SOURCE_LABEL[s] ?? IDEA_SOURCE_LABEL[s] ?? s;
  protected readonly planned = signal<Record<string, number>>({});

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected decide(verdict: Verdict): void {
    const item = this.current();
    if (!item || this.leaving()) return;
    if (item.kind === 'idea' && verdict === 'approve' && !(item.i.projectSlug || this.pickSlug())) {
      this.error.set('Escolha o projeto da ideia antes de aprovar.');
      return;
    }
    this.error.set(null);
    this.leaving.set(verdict);
    setTimeout(async () => {
      try {
        if (item.kind === 'decision') this.proposals.decide(item.p, verdict);
        else if (verdict === 'approve') await this.ideas.approve(item.i.id, item.i.projectSlug ? null : this.pickSlug());
        else if (verdict === 'reject') this.ideas.setStatus(item.i.id, 'archived');
        else this.skipped.update(s => new Set([...s, item.i.id]));
      } catch (e) {
        this.error.set(errorMessage(e));
      }
      this.pickSlug.set('');
      this.leaving.set(null);
    }, reducedMotion() ? 120 : 220);
  }

  protected onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.querySelector('dialog[open]')) return;
    const verdict = KEYS[e.key.toLowerCase()];
    if (verdict) this.decide(verdict);
  }

  protected async plan(slug: string): Promise<void> {
    try {
      const id = await this.direction.plan(slug);
      this.planned.update(m => ({ ...m, [slug]: id }));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async capture(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.title().trim()) return;
    try {
      await this.ideas.create(this.title().trim(), this.body().trim(), this.projectSlug() || null);
      this.title.set('');
      this.body.set('');
      this.error.set(null);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
