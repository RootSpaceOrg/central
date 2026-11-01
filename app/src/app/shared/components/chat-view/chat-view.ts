import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';

import { ChatService, ChatSession } from '../../services/chat/chat.service';
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

/** Conversa com o agente atual do ChatService: mensagens, passos recolhíveis e caixa de mensagem. */
@Component({
  selector: 'app-chat-view',
  imports: [Icon, MarkdownPipe, ProjectAvatar],
  templateUrl: './chat-view.html',
  host: { class: 'flex min-h-0 flex-col' },
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

  protected readonly text = signal('');
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
    effect(() => {
      this.s().messages();
      this.s().currentBusy();
      const el = this.list()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    });
    effect(() => {
      this.s().current();
      this.s().agentId();
      queueMicrotask(() => this.input()?.nativeElement.focus());
    });
    effect(() => {
      // o rascunho abre o painel lateral: só ele consome (a tela Agentes tem outro ChatView)
      const draft = this.service.draft();
      if (draft === null || !this.compact()) return;
      this.text.set(draft);
      this.service.draft.set(null);
      queueMicrotask(() => { const el = this.input()?.nativeElement; el?.focus(); el?.setSelectionRange(draft.length, draft.length); });
    });
  }

  focus(): void { this.input()?.nativeElement.focus(); }

  protected send(text = this.text()): void {
    if (!text.trim() || this.s().currentBusy()) return;
    this.s().send(text.trim());
    this.text.set('');
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
