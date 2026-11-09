import { Component, computed, effect, inject, input, signal } from '@angular/core';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { IdeasService } from '../../../../../../shared/services/ideas/ideas.service';
import { LiveService, doing } from '../../../../../../shared/services/live/live.service';
import { Project } from '../../../../../../shared/services/projects/projects.model';
import { HORIZONS, MilestoneEvent, RoadmapService } from '../../../../../../shared/services/roadmap/roadmap.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon, IconName } from '../../../../../../shared/ui/icon';
import { Select, SelectOption } from '../../../../../../shared/ui/select';
import { RoadmapPanel } from './roadmap-panel';

const KINDS = [
  { id: 'reuniao', label: 'Reunião', text: 'a transcrição de uma reunião', hint: 'Cole a transcrição (ou carregue .txt, .md, .vtt, .srt).' },
  { id: 'notas', label: 'Notas', text: 'notas soltas', hint: 'Anotações, conversa com cliente, e-mail…' },
  { id: 'rumo', label: 'Direcionamento', text: 'um direcionamento', hint: 'O que você quer que mude no roadmap, em texto livre.' },
] as const;
type Kind = (typeof KINDS)[number]['id'];

const MAX = 200_000;

const EVENT_ICON: Record<string, IconName> = { created: 'plus', moved: 'arrowRight', done: 'check', edited: 'edit', deleted: 'close' };

/** O que a Central faz com o texto: ajustar marcos e sugerir ideias ligadas, sem tarefas nem mexer no rumo. */
export function feedPrompt(p: Pick<Project, 'name' | 'slug'>, kind: string, text: string, today: string): string {
  return `[roadmap:alimentar] Projeto ${p.name} (project_slug: ${p.slug}). O Gustavo trouxe ${kind} para alimentar o roadmap:

<<<
${text}
>>>

Faça assim:
1. Leia o rumo (get_direction), o roadmap (list_milestones) e as ideias do projeto (list_ideas com project_slug).
2. Ajuste o roadmap pelo que foi dito: crie marcos para resultados novos que importam (create_milestone), mova de horizonte ou renomeie os existentes quando a prioridade mudou (update_milestone) e marque como feito (done) o que foi dado como entregue. Sempre preencha note com a origem curta (ex.: "reunião ${today}: cliente pediu X").
3. Pedidos concretos viram ideias ligadas ao marco (create_idea com project_slug e milestone_id); elas vão para a triagem do Gustavo. Não crie tarefas.
4. Se algo muda o rumo do projeto, não altere o rumo: diga o que mudaria.
5. Não invente: o que o texto não diz, não mexa.
No fim, um resumo curto: marcos criados, movidos e concluídos, ideias sugeridas e o que ficou em aberto.`;
}

/**
 * Aba Roadmap do projeto: as colunas (Agora / Próximo / Depois), o que alimenta o roadmap (ideias sem marco, reunião,
 * notas ou direcionamento que a Central lê e transforma em marcos e ideias) e o histórico de quem mexeu e por quê.
 */
@Component({
  selector: 'app-roadmap-tab',
  imports: [RoadmapPanel, Icon, AgoPipe, Select],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @let p = project();
    <div class="grid grid-cols-1 gap-8 px-8 pt-7 pb-16 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)] xl:px-10">
      <div class="min-w-0 space-y-8">
        <app-roadmap-panel [project]="p" />

        <!-- ideias que ainda não servem a nenhum marco -->
        <section aria-labelledby="loose-title">
          <div class="mb-3 flex items-baseline justify-between">
            <h2 id="loose-title" class="font-display text-lg font-semibold">Ideias sem marco <span class="text-mute">{{ loose().length }}</span></h2>
            <span class="text-[12.5px] text-faint">Ligue a ideia ao marco que ela serve: o progresso dele passa a contar as tarefas dela.</span>
          </div>
          @if (loose().length) {
            <ul class="overflow-hidden rounded-2xl border border-edge">
              @for (i of loose(); track i.id) {
                <li class="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5 last:border-0">
                  <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" [class]="i.status === 'new' ? 'bg-later/15 text-later' : 'bg-yes/15 text-yes'">{{ i.status === 'new' ? 'para triar' : 'aprovada' }}</span>
                  <span class="min-w-0 flex-1 truncate text-[13.5px]" [title]="i.body ?? i.title">{{ i.title }}</span>
                  @if (i.author !== 'gustavo') { <span class="shrink-0 text-[11.5px] text-faint">de {{ i.author }}</span> }
                  <app-select class="w-52 shrink-0" [compact]="true" [action]="true" [options]="openOptions()" (picked)="link(i.id, $event)"
                              placeholder="Ligar a um marco…" [label]="'Ligar ' + i.title + ' a um marco'" [minWidth]="300" />
                </li>
              }
            </ul>
          } @else {
            <p class="rounded-2xl border border-dashed border-edge px-5 py-4 text-[13px] text-mute">Toda ideia aprovada ou em triagem já serve a um marco.</p>
          }
        </section>
      </div>

      <aside class="space-y-8">
        <!-- alimentar: a Central lê e mexe no roadmap -->
        <section class="rounded-2xl border border-edge bg-panel p-5" aria-labelledby="feed-title">
          <h2 id="feed-title" class="flex items-center gap-2 font-display text-lg font-semibold"><app-icon name="spark" [size]="17" class="text-frost" />Alimentar o roadmap</h2>
          <p class="mt-1 text-[13px] text-mute">A Central lê, cria ou move marcos (dizendo de onde veio) e sugere ideias ligadas a eles. Não cria tarefas nem muda o rumo.</p>
          <div class="mt-3 flex gap-1 rounded-full border border-edge bg-night p-1" role="radiogroup" aria-label="O que é o texto">
            @for (k of kinds; track k.id) {
              <button type="button" role="radio" [attr.aria-checked]="kind() === k.id" (click)="kind.set(k.id)"
                      class="flex-1 rounded-full py-1 text-[12.5px] font-semibold" [class]="kind() === k.id ? 'bg-raise' : 'text-mute hover:text-text'">{{ k.label }}</button>
            }
          </div>
          <textarea class="field mt-3 h-40 w-full resize-y text-[13px]" [placeholder]="kindDef().hint" aria-label="Texto para a Central ler"
                    [value]="text()" (input)="text.set($any($event.target).value)" (keydown.control.enter)="feed()"></textarea>
          <div class="mt-2 flex items-center gap-3">
            <label class="cursor-pointer text-[12.5px] text-frost hover:underline">
              Carregar arquivo<input type="file" class="sr-only" accept=".txt,.md,.vtt,.srt,.csv,text/*" (change)="load($event)" />
            </label>
            <span class="flex-1 text-[11.5px] tabular-nums text-faint">@if (text().length) { {{ text().length.toLocaleString('pt-BR') }} caracteres }</span>
            <button type="button" class="btn btn-sm btn-primary" [disabled]="!text().trim() || busy()" (click)="feed()">Mandar para a Central</button>
          </div>
          @if (error()) { <p role="alert" class="mt-2 text-[12.5px] text-no">{{ error() }}</p> }
          @for (f of feeds(); track f.chatId) {
            <button type="button" class="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-edge bg-night px-3 py-2 text-left hover:border-faint" (click)="chat.openInPanel(f.chatId)">
              @if (live.chat(f.chatId); as a) {
                <span class="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-frost border-t-transparent"></span>
                <span class="min-w-0 flex-1"><span class="block text-[12.5px] font-semibold">Central lendo {{ f.label }}</span>
                  <span class="block truncate text-[12px] text-mute">{{ doing(a) ?? 'pensando…' }}</span></span>
              } @else {
                <app-icon name="check" [size]="14" class="shrink-0 text-yes" />
                <span class="min-w-0 flex-1 text-[12.5px]">Central leu {{ f.label }} · ver o que fez</span>
              }
            </button>
          }
        </section>

        <!-- histórico: quem mexeu e por quê -->
        <section aria-labelledby="hist-title">
          <h2 id="hist-title" class="mb-3 font-display text-lg font-semibold">Histórico</h2>
          @for (e of events(); track e.id) {
            <div class="flex gap-2.5 border-l border-edge py-1.5 pl-3">
              <app-icon [name]="eventIcon(e.kind)" [size]="13" class="mt-0.5 shrink-0" [class]="e.kind === 'done' ? 'text-yes' : e.kind === 'deleted' ? 'text-no' : 'text-faint'" />
              <div class="min-w-0 flex-1">
                <p class="text-[13px]"><b class="font-semibold">{{ e.title }}</b></p>
                @if (e.detail) { <p class="text-[12px] text-mute">{{ e.detail }}</p> }
                <p class="text-[11.5px] text-faint">
                  @if (e.author === 'gustavo') { você } @else { <span class="text-frost">{{ e.author }}</span> } · {{ e.at | ago }}
                </p>
              </div>
            </div>
          } @empty {
            <p class="text-[13px] text-mute">Nada ainda. Cada marco criado, movido ou concluído aparece aqui, com quem fez e por quê.</p>
          }
        </section>
      </aside>
    </div>
  `,
})
export class RoadmapTab {
  protected readonly roadmap = inject(RoadmapService);
  protected readonly chat = inject(ChatService);
  protected readonly live = inject(LiveService);
  private readonly ideas = inject(IdeasService);
  private readonly agents = inject(AgentsService);

  readonly project = input.required<Project>();

  protected readonly kinds = KINDS;
  protected readonly doing = doing;
  protected readonly kind = signal<Kind>('reuniao');
  protected readonly kindDef = computed(() => KINDS.find(k => k.id === this.kind())!);
  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly events = signal<MilestoneEvent[]>([]);
  /** leituras mandadas nesta sessão do app (por projeto) */
  private static readonly sent = signal<{ slug: string; chatId: number; label: string }[]>([]);
  protected readonly feeds = computed(() => RoadmapTab.sent().filter(f => f.slug === this.project().slug));

  protected readonly open = computed(() => this.roadmap.of(this.project().slug).filter(m => m.horizon !== 'done')
    .sort((a, b) => HORIZONS.findIndex(h => h.id === a.horizon) - HORIZONS.findIndex(h => h.id === b.horizon) || a.position - b.position));
  protected readonly openOptions = computed<SelectOption[]>(() => this.open().map(m => ({ value: String(m.id), label: `${this.horizonLabel(m.horizon)} · ${m.title}` })));
  protected readonly loose = computed(() => this.ideas.ideas().filter(i =>
    i.projectSlug === this.project().slug && !i.milestoneId && (i.status === 'new' || i.status === 'approved')));

  constructor() {
    // o histórico acompanha qualquer mudança no roadmap (aqui, pelo MCP ou pelo gestor)
    effect(() => {
      this.roadmap.all();
      const slug = this.project().slug;
      this.roadmap.events(slug).then(list => { if (slug === this.project().slug) this.events.set(list); });
    });
  }

  protected horizonLabel(h: string): string { return HORIZONS.find(x => x.id === h)?.label ?? h; }
  protected eventIcon(kind: string): IconName { return EVENT_ICON[kind] ?? 'flag'; }

  protected link(ideaId: number, value: string): void {
    if (value) this.ideas.setMilestone(ideaId, Number(value));
  }

  protected async load(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    if (file.size > MAX * 2) { this.error.set('Arquivo grande demais (máximo ~400 KB de texto).'); return; }
    this.text.set((await file.text()).slice(0, MAX));
    this.error.set(null);
  }

  protected async feed(): Promise<void> {
    const text = this.text().trim();
    const central = this.agents.central();
    if (!text || !central || this.busy()) return;
    if (text.length > MAX) { this.error.set(`Texto grande demais (máximo ${MAX.toLocaleString('pt-BR')} caracteres).`); return; }
    this.busy.set(true);
    this.error.set(null);
    try {
      const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const chatId = await this.chat.startBackground(central.id, feedPrompt(this.project(), this.kindDef().text, text, today));
      RoadmapTab.sent.update(l => [{ slug: this.project().slug, chatId, label: `${this.kindDef().label.toLowerCase()} de ${today}` }, ...l]);
      this.text.set('');
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
