import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';

import { ChatService } from '../../services/chat/chat.service';
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
  protected readonly chat = inject(ChatService);
  private readonly projects = inject(ProjectsService);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  /** painel lateral: menos espaço */
  readonly compact = input(false);

  protected readonly text = signal('');
  protected readonly expanded = signal<Set<number>>(new Set());
  protected readonly copied = signal<number | null>(null);

  protected readonly suggestions = computed(() => {
    const a = this.chat.agent();
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
      this.chat.messages();
      this.chat.currentBusy();
      const el = this.list()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    });
    effect(() => {
      this.chat.current();
      this.chat.agentId();
      queueMicrotask(() => this.input()?.nativeElement.focus());
    });
    effect(() => {
      // o rascunho abre o painel lateral: só ele consome (a tela Agentes tem outro ChatView)
      const draft = this.chat.draft();
      if (draft === null || !this.compact()) return;
      this.text.set(draft);
      this.chat.draft.set(null);
      queueMicrotask(() => { const el = this.input()?.nativeElement; el?.focus(); el?.setSelectionRange(draft.length, draft.length); });
    });
  }

  focus(): void { this.input()?.nativeElement.focus(); }

  protected send(text = this.text()): void {
    if (!text.trim() || this.chat.currentBusy()) return;
    this.chat.send(text.trim());
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
