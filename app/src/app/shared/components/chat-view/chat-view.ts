import { Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';

import { ChatService, ChatSession } from '../../services/chat/chat.service';
import { ChatPrefsService } from '../../services/chat-prefs/chat-prefs.service';
import { CHAT_MODELS, EFFORTS } from '../../services/agents/agents.service';
import { ContextMenuService } from '../../services/context-menu/context-menu.service';
import { DictationService, Recording } from '../../services/dictation/dictation.service';
import { IpcService, errorMessage } from '../../services/ipc/ipc.service';
import { ChatImage } from '../chat-image/chat-image';
import { LiveService, elapsed } from '../../services/live/live.service';
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

const IMG = /\[\[img:([^\]\n]+)\]\]/g;

/**
 * O Claude aceita imagens de até ~5 MB: print grande (4K em PNG) vira JPEG com no máximo 2000 px no lado maior.
 * Imagem pequena segue como veio.
 */
async function fitImage(file: File): Promise<Blob> {
  const ok = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type);
  if (ok && file.size <= 3.5 * 1024 * 1024) return file;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

/** quantos itens a conversa desenha de cada vez (o resto entra ao rolar para cima) */
const PAGE = 60;

/** Rascunho de cada conversa (por sessão e conversa): trocar de aba não leva o texto junto, voltar traz de volta. */
const drafts = new WeakMap<ChatSession, Map<string, string>>();

/** Conversa com o agente atual do ChatService: mensagens, passos recolhíveis e caixa de mensagem. */
@Component({
  selector: 'app-chat-view',
  imports: [Icon, MarkdownPipe, ProjectAvatar, ChatImage],
  templateUrl: './chat-view.html',
  host: { class: 'flex min-h-0 flex-col', '(keydown)': 'zoomKey($event)' },
})
export class ChatView implements OnDestroy {
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
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');
  /**
   * Grudado no fim: o conteúdo cresce depois de abrir (histórico chegando, markdown, itens fora da tela trocando a altura
   * estimada pela real). Enquanto você não rolar para cima, toda mudança de altura leva de volta ao final, sem animação.
   */
  private readonly grow = new ResizeObserver(() => { if (this.atBottom) this.toBottom(); });
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  /** painel lateral: menos espaço */
  readonly compact = input(false);

  protected readonly prefs = inject(ChatPrefsService);
  protected readonly live = inject(LiveService);
  protected readonly showSubs = signal(true);
  protected readonly since = elapsed;
  private readonly menu = inject(ContextMenuService);
  protected readonly modelLabel = computed(() => CHAT_MODELS.find(m => m.value === this.s().model())?.label ?? this.s().model());
  protected readonly effortLabel = computed(() => {
    const e = EFFORTS.find(x => x.value === this.s().effort());
    return e?.value ? e.label : 'Raciocínio';
  });
  protected readonly text = signal('');

  /** ditado: fala → texto na caixa (extensão Transcrição) */
  protected readonly dictation = inject(DictationService);
  protected readonly mic = signal<'idle' | 'rec' | 'busy'>('idle');
  protected readonly micSecs = signal(0);
  protected readonly micError = signal<string | null>(null);
  private rec: Recording | null = null;
  private micTimer: ReturnType<typeof setInterval> | undefined;
  protected async toggleMic(): Promise<void> {
    if (this.mic() === 'busy') return;
    this.micError.set(null);
    if (this.mic() === 'idle') {
      try { this.rec = await this.dictation.record(); }
      catch { this.micError.set('Não deu para usar o microfone (permissão do Windows em Privacidade → Microfone?).'); return; }
      this.mic.set('rec');
      this.micSecs.set(0);
      this.micTimer = setInterval(() => this.micSecs.update(n => n + 1), 1000);
      return;
    }
    clearInterval(this.micTimer);
    this.mic.set('busy');
    try {
      const said = (await this.dictation.transcribe(await this.rec!.stop())).trim();
      if (said) {
        const cur = this.text();
        this.setText(cur.trim() ? `${cur.replace(/\s+$/, '')} ${said}` : said);
        const el = this.input()?.nativeElement;
        if (el) { el.value = this.text(); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      } else this.micError.set('Não entendi nada no áudio.');
    } catch (e) {
      this.micError.set(errorMessage(e));
    } finally {
      this.rec = null;
      this.mic.set('idle');
    }
  }
  protected cancelMic(): void { clearInterval(this.micTimer); this.rec?.cancel(); this.rec = null; this.mic.set('idle'); }
  /** janela: só os últimos itens são desenhados; rolar até o topo traz mais */
  private readonly limit = signal(PAGE);
  protected readonly visible = computed(() => this.s().items().slice(-this.limit()));
  protected readonly hidden = computed(() => Math.max(0, this.s().items().length - this.limit()));
  /** o usuário está no fim da conversa (só então o conteúdo novo puxa a rolagem) */
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
        requestAnimationFrame(() => { this.toBottom(); this.input()?.nativeElement.focus(); });
      });
    });
    effect(() => { const el = this.content()?.nativeElement; if (el) this.grow.observe(el); });
    // mensagem nova ou status mudou: acompanha só se o usuário já estava no fim
    effect(() => {
      this.s().messages();
      this.s().currentBusy();
      untracked(() => { if (this.atBottom) requestAnimationFrame(() => this.toBottom()); });
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

  /** Menus de modelo e raciocínio abrem acima do botão; a escolha vale para esta conversa e vira o padrão das próximas. */
  private openAbove(e: MouseEvent, n: number) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return new MouseEvent('click', { clientX: r.left, clientY: Math.max(8, r.top - 8 - n * 34) });
  }

  protected pickModel(e: MouseEvent): void {
    const s = this.s();
    this.menu.open(this.openAbove(e, CHAT_MODELS.length), CHAT_MODELS.map(m => ({
      label: m.label, hint: s.model() === m.value ? '✓' : m.hint, run: () => this.choose(m.value, s.effort()),
    })));
  }

  protected pickEffort(e: MouseEvent): void {
    const s = this.s();
    this.menu.open(this.openAbove(e, EFFORTS.length), EFFORTS.map(x => ({
      label: x.label, hint: s.effort() === x.value ? '✓' : undefined, run: () => this.choose(s.model(), x.value),
    })));
  }

  private choose(model: string, effort: string): void {
    this.s().model.set(model);
    this.s().effort.set(effort);
    this.prefs.set({ chatDefaults: { model, effort } });
    this.input()?.nativeElement.focus();
  }

  protected setText(value: string): void {
    this.text.set(value);
    const s = this.s();
    if (!drafts.has(s)) drafts.set(s, new Map());
    drafts.get(s)!.set(this.draftKey, value);
  }

  protected send(text = this.text()): void {
    const imgs = this.attachments();
    if (!text.trim() && !imgs.length) return; // respondendo: a mensagem entra na mesma sessão (ele lê assim que terminar o passo atual)
    // as imagens vão como marcadores no texto; a Central troca por blocos de imagem para o Claude
    this.s().send([text.trim(), ...imgs.map(a => `[[img:${a.path}]]`)].filter(Boolean).join('\n'));
    this.setText('');
    for (const a of imgs) URL.revokeObjectURL(a.url);
    this.attachments.set([]);
    this.atBottom = true;
  }

  // ---------- imagens: colar print, arrastar ou escolher arquivo ----------
  private readonly ipc = inject(IpcService);
  protected readonly attachments = signal<{ path: string; url: string }[]>([]);
  protected readonly attaching = signal(false);
  protected readonly dropping = signal(false);
  /** texto da mensagem sem os marcadores, e as imagens dela */
  protected readonly plain = (t: string) => t.replace(IMG, '').replace(/\n{3,}/g, '\n\n').trim();
  protected readonly imagesOf = (t: string) => [...t.matchAll(IMG)].map(m => m[1]);

  protected onPaste(e: ClipboardEvent): void {
    const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    files.forEach(f => this.attach(f));
  }
  protected onDrop(e: DragEvent): void {
    this.dropping.set(false);
    const files = [...(e.dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    files.forEach(f => this.attach(f));
  }
  protected onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    [...(input.files ?? [])].forEach(f => this.attach(f));
    input.value = '';
  }
  protected removeAttachment(path: string): void {
    this.attachments.update(l => l.filter(a => { if (a.path === path) URL.revokeObjectURL(a.url); return a.path !== path; }));
  }
  private async attach(file: File): Promise<void> {
    this.attaching.set(true);
    this.micError.set(null);
    try {
      const blob = await fitImage(file);
      const ext = blob.type === 'image/jpeg' ? 'jpg' : (blob.type.split('/')[1] ?? 'png');
      const path = await this.ipc.invoke('chat:attach', new Uint8Array(await blob.arrayBuffer()), ext);
      this.attachments.update(l => [...l, { path, url: URL.createObjectURL(blob) }]);
      this.input()?.nativeElement.focus({ preventScroll: true });
    } catch (err) {
      this.micError.set(errorMessage(err));
    } finally {
      this.attaching.set(false);
    }
  }

  /** Direto ao fim (sem animação: a rolagem suave gerava eventos no meio do caminho que soltavam o "grudado no fim"). */
  private toBottom(): void {
    const el = this.list()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
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

  ngOnDestroy(): void { this.grow.disconnect(); this.cancelMic(); }

  protected time(d: Date): string { return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
}
