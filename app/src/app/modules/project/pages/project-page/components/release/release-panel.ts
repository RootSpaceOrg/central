import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { Project } from '../../../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { ReleaseRepo, ReleaseService } from '../../../../../../shared/services/release/release.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';

/** O que o agente precisa para montar a subida (sem mandar o histórico inteiro). */
function preparePrompt(p: Project, repos: ReleaseRepo[]): string {
  const lines = repos.filter(r => r.items.length).map(r =>
    `- ${r.name} (${r.dev} → ${r.prod}, ${r.commits} commits):\n${r.items.slice(0, 25).map(i => `  - ${i.pr ? `PR #${i.pr} ` : ''}${i.title} (${i.author}, ${i.at.toLocaleDateString('pt-BR')})${i.delivery ? ` [entrega: ${i.delivery}]` : ''}`).join('\n')}`);
  return `[producao:preparar] Projeto ${p.name} (project_slug: ${p.slug}). O Gustavo quer saber o que pode ir para produção e montar a subida.
O que está em develop e não em main:
${lines.join('\n')}

Faça assim:
1. Para cada repositório, veja se o que está em develop está pronto (testes/CI verdes, nada pela metade, dependências entre repos).
2. Monte o pacote: PRs ${'develop → main'} por repositório (pode abrir com gh pr create --base main --head develop, sem fazer merge), ordem de deploy (infra/gateway → lambdas → front quando se aplicar), riscos e como validar depois.
3. Abra uma decisão (create_decision) para o Gustavo aprovar, com o pacote no texto. Nunca faça merge em main nem rode nada em produção.
4. O que não deve ir agora: diga por quê.
No fim, resuma em poucas linhas.`;
}

/**
 * Aba Produção: por repositório, o que está em develop e ainda não foi para main (PRs, há quanto tempo, de qual entrega
 * de agente veio). "Preparar subida" pede ao responsável do projeto (ou à Central) o pacote como decisão para você aprovar.
 */
@Component({
  selector: 'app-release-panel',
  imports: [Icon, AgoPipe],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @let p = project();
    <div class="mx-auto max-w-5xl px-8 pt-7 pb-16">
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex-1">
          <h2 class="font-display text-xl font-semibold">A caminho de produção</h2>
          <p class="mt-0.5 text-[13.5px] text-mute">O que já está em develop (no ambiente de dev) e ainda não está em main.</p>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" (click)="release.load(p.slug, true)" [disabled]="loading()">
          <app-icon name="sync" [size]="14" [class.animate-spin]="loading()" />{{ loading() ? 'Buscando…' : 'Atualizar' }}</button>
        @if (pending()) {
          <button type="button" class="btn btn-sm btn-primary" (click)="prepare()" [disabled]="preparing()"
                  [title]="'Pede a ' + who() + ' o pacote de subida como decisão para você aprovar'"><app-icon name="spark" [size]="14" />Preparar subida</button>
        }
      </div>
      @if (error()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ error() }}</p> }

      @if (repos(); as list) {
        <div class="mt-5 space-y-4">
          @for (r of (showAll() ? list : pendingRepos()); track r.path) {
            <section class="rounded-2xl border border-edge bg-panel" [class.opacity-60]="!r.items.length">
              <header class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3" [class.border-b]="r.items.length" [class.border-edge]="r.items.length">
                <span class="font-semibold">{{ r.name }}</span>
                @if (r.url) {
                  <button type="button" class="rounded p-1 text-faint hover:bg-raise hover:text-text" (click)="projects.openExternal(r.url)"
                          title="Abrir o repositório no navegador" aria-label="Abrir o repositório no navegador"><app-icon name="external" [size]="14" /></button>
                  @if (r.items.length && r.dev && r.prod) {
                    <button type="button" class="rounded px-1.5 py-0.5 text-[12px] text-faint hover:bg-raise hover:text-text" (click)="projects.openExternal(r.url + '/compare/' + r.prod + '...' + r.dev)"
                            title="Ver no GitHub tudo o que está em develop e não em main">comparar</button>
                  }
                }
                @if (r.dev && r.prod) {
                  <span class="font-mono text-[12px] text-faint">{{ r.dev }} → {{ r.prod }}</span>
                  <span class="flex-1"></span>
                  @if (r.items.length) {
                    <span class="text-[13px]"><b>{{ prs(r) }}</b> {{ prs(r) === 1 ? 'PR' : 'PRs' }} · {{ r.commits }} commits</span>
                    @if (r.oldestAt) { <span class="rounded-full bg-raise px-2 py-0.5 text-[12px] text-mute">esperando · {{ r.oldestAt | ago }}</span> }
                  } @else { <span class="text-[13px] text-yes">em dia com produção</span> }
                } @else {
                  <span class="flex-1"></span><span class="text-[12.5px] text-faint">{{ !r.dev ? 'não usa develop' : 'sem main/master no remoto' }}</span>
                }
              </header>
              @if (r.error) { <p class="px-5 pt-2 text-[12.5px] text-later">{{ r.error }}</p> }
              @if (r.items.length) {
                <ul class="divide-y divide-edge">
                  @for (i of r.items; track i.sha) {
                    <li class="flex items-center gap-3 px-5 py-2.5 text-[13.5px]">
                      @if (i.pr) {
                        <button type="button" class="shrink-0 font-mono text-[12.5px] text-frost hover:underline" (click)="i.url && projects.openExternal(i.url)">#{{ i.pr }}</button>
                      } @else { <span class="shrink-0 font-mono text-[12px] text-faint" title="commit direto, sem PR">{{ i.sha.slice(0, 7) }}</span> }
                      <span class="min-w-0 flex-1 truncate" [title]="i.title">{{ i.title }}</span>
                      @if (i.delivery) { <span class="shrink-0 rounded bg-frost/10 px-1.5 text-[11.5px] text-frost" [title]="'Entrega: ' + i.delivery">✦ agente@if (i.taskId) { · #{{ i.taskId }} }</span> }
                      <span class="shrink-0 text-[12px] text-faint">{{ i.author }} · {{ i.at | ago }}</span>
                    </li>
                  }
                </ul>
              }
            </section>
          } @empty {
            <p class="rounded-2xl border border-dashed border-edge px-5 py-6 text-center text-mute">
              {{ list.length ? 'Tudo o que está em develop já está em produção.' : 'Este projeto não tem repositórios.' }}</p>
          }
          @if (list.length > pendingRepos().length) {
            <button type="button" class="text-[13px] text-mute hover:text-text" (click)="showAll.set(!showAll())">
              {{ showAll() ? 'Esconder os em dia' : (list.length - pendingRepos().length) + ' repositórios em dia com produção (ou sem develop) · mostrar' }}</button>
          }
        </div>
      } @else {
        <p class="mt-6 text-mute">Lendo os repositórios…</p>
      }
    </div>
  `,
})
export class ReleasePanel {
  protected readonly release = inject(ReleaseService);
  protected readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);

  readonly project = input.required<Project>();

  protected readonly preparing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly repos = computed(() => this.release.bySlug()[this.project().slug] ?? null);
  protected readonly loading = computed(() => !!this.release.loading()[this.project().slug]);
  protected readonly pending = computed(() => (this.repos() ?? []).some(r => r.items.length));
  /** com algo esperando, o mais antigo primeiro */
  protected readonly pendingRepos = computed(() => (this.repos() ?? []).filter(r => r.items.length)
    .sort((a, b) => (a.oldestAt?.getTime() ?? 0) - (b.oldestAt?.getTime() ?? 0)));
  protected readonly showAll = signal(false);
  /** quem monta a subida: o responsável do projeto, senão a Central */
  private readonly owner = computed(() => this.agents.byId().get(this.project().todoAgentId ?? -1) ?? this.agents.central());
  protected readonly who = computed(() => this.owner()?.name ?? 'Central');

  constructor() {
    effect(() => { const slug = this.project().slug; untracked(() => this.release.load(slug)); });
  }

  protected prs(r: ReleaseRepo): number { return r.items.filter(i => i.pr).length || r.items.length; }

  protected async prepare(): Promise<void> {
    const agent = this.owner();
    if (!agent) return;
    this.preparing.set(true);
    try {
      const id = await this.chat.startBackground(agent.id, preparePrompt(this.project(), this.repos() ?? []));
      this.chat.openInPanel(id);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.preparing.set(false);
    }
  }
}
