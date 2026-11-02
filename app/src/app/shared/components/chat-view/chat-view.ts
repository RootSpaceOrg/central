import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';

import { ChatService, ChatSession } from '../../services/chat/chat.service';
import { ChatPrefsService } from '../../services/chat-prefs/chat-prefs.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { Icon } from '../../ui/icon';
import { MarkdownPipe } from '../../ui/markdown';
import { ProjectAvatar } from '../../ui/project-avatar';

const CENTRAL_SUGGESTIONS = [
  'O que está pendente hoje, em todos os projetos?',
  'Organize o backlog do KultivAi por prioridade.',
  'Crie um agente de suporte para o Alfabetizare.',
  'Quais projetos estão parados há mais de duas semanas?',
];

/** quantos itens a conversa desenha de cada vez (o resto entra ao rolar para cima) */
const PAGE = 60;

/** Rascunho de cada conversa (por sessão e conversa): trocar de aba não leva o texto junto, voltar traz de volta. */
const drafts = new WeakMap<ChatSession, Map<string, string>>();

/** Conversa com o agente atual do ChatService: mensagens, passos recolhíveis e caixa de mensagem. */
@Component({
  selector: 'app-chat-view',
  imports: [Icon, MarkdownPipe, ProjectAvatar],
  templateUrl: './chat-view.html',
  host: { class: 'flex min-h-0 flex-col', '(keydown)': 'zoomKey($event)' },
})
export class ChatView {
  private readonly service = inject(ChatService);
  private readonly projects = inject(ProjectsService);
  /** conversa de uma aba de sessão; sem ela, usa a conversa compartilhada (painel e tela Agentes) */
  readonly session = input<ChatSession | null>(null);
  protected readonly s = computed(() => this.session() ?? this.service);
  /** nas sessões de projeto quem fala é o Claude no projeto: mostra o ícone do projeto */
  protected readonly avatar = computed(() => {
    const slug = this.s().projectSlug;
    return (slug ? this.projects.bySlug().get(slug) : null) ?? this.s().agent();
  });
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  /** painel lateral: menos espaço */
  readonly compact = input(false);

  protected readonly prefs = inject(ChatPrefsService);
  protected readonly text = signal('');
  /** janela: só os últimos itens são desenhados; rolar até o topo traz mais */
  private readonly limit = signal(PAGE);
  protected readonly visible = computed(() => this.s().items().slice(-this.limit()));
  protected readonly hidden = computed(() => Math.max(0, this.s().items().length - this.limit()));
  /** o usuário está no fim da conversa (só então mensagens novas puxam a rolagem) */
  private atBottom = true;
  private draftKey = '';
  protected readonly expanded = signal<Set<number>>(new Set());
  protected readonly copied = signal<number | null>(null);

  protected readonly suggestions = computed(() => {
    const slug = this.s().projectSlug;
    if (slug) return [
      'O que mudou neste projeto nos últimos dias?',
      'Qual a próxima tarefa do backlog? Vamos começar.',
      'Rode os testes e me diga o que está quebrado.',
      'Revise o que está sem commit e sugira os commits.',
    ];
    const a = this.s().agent();
    if (!a || a.builtin) return CENTRAL_SUGGESTIONS;
    const project = a.projectSlug ? this.projects.bySlug().get(a.projectSlug)?.name : null;
    return [
      'Quem é você e no que pode me ajudar?',
      project ? `O que está pendente no ${project}?` : 'O que você enxerga de mais importante nos projetos agora?',
      'Me dê 3 sugestões concretas para esta semana.',
    ];
  });

  constructor() {
    // trocou de conversa: janela volta ao tamanho inicial, vai direto ao fim (sem animar a conversa toda) e traz o rascunho dela
    effect(() => {
      const s = this.s();
      const key = String(s.current() ?? 'new');
      s.agentId();
      untracked(() => {
        this.limit.set(PAGE);
        this.atBottom = true;
        this.draftKey = key;
        const draft = drafts.get(s)?.get(key) ?? '';
        this.text.set(draft);
        // também no campo: se a troca vier no meio da digitação, o valor ligado ainda não foi atualizado na tela
        const el = this.input()?.nativeElement;
        if (el) el.value = draft;
        requestAnimationFrame(() => { this.toBottom('auto'); this.input()?.nativeElement.focus(); });
      });
    });
    // mensagem nova: acompanha só se o usuário já estava no fim
    effect(() => {
      this.s().messages();
      this.s().currentBusy();
      untracked(() => { if (this.atBottom) requestAnimationFrame(() => this.toBottom('smooth')); });
    });
    effect(() => {
      // o rascunho abre o painel lateral: só ele consome (a tela Agentes tem outro ChatView)
      const draft = this.service.draft();
      if (draft === null || !this.compact()) return;
      this.setText(draft);
      this.service.draft.set(null);
      queueMicrotask(() => { const el = this.input()?.nativeElement; el?.focus(); el?.setSelectionRange(draft.length, draft.length); });
    });
  }

  focus(): void { this.input()?.nativeElement.focus(); }

  protected setText(value: string): void {
    this.text.set(value);
    const s = this.s();
    if (!drafts.has(s)) drafts.set(s, new Map());
    drafts.get(s)!.set(this.draftKey, value);
  }

  protected send(text = this.text()): void {
    if (!text.trim() || this.s().currentBusy()) return;
    this.s().send(text.trim());
    this.setText('');
    this.atBottom = true;
  }

  private toBottom(behavior: ScrollBehavior): void {
    const el = this.list()?.nativeElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }

  protected onScroll(): void {
    const el = this.list()?.nativeElement;
    if (!el) return;
    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 150 && this.hidden()) this.older();
  }

  /** Mais itens acima, mantendo o que está na tela no mesmo lugar. */
  protected older(): void {
    const el = this.list()?.nativeElement;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    this.limit.update(n => n + PAGE);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  }

  /** Ctrl + / Ctrl - / Ctrl 0: tamanho do texto das conversas (vale para todas; também em Preferências). */
  protected zoomKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '=' || e.key === '+') this.prefs.bump(1);
    else if (e.key === '-') this.prefs.bump(-1);
    else if (e.key === '0') this.prefs.set({ fontSize: 13 });
    else return;
    e.preventDefault();
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  protected toggleSteps(id: number): void {
    this.expanded.update(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  protected copy(id: number, text: string): void {
    navigator.clipboard.writeText(text);
    this.copied.set(id);
    setTimeout(() => this.copied.set(null), 1500);
  }

  protected time(d: Date): string { return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
}
