import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';

import { ChatDto, ChatMessageDto, ChatRole } from '../../contract';
import { AgentsService } from '../agents/agents.service';
import { errorMessage } from '../ipc/ipc.service';
import { ChatApiService } from './chat-api.service';
import { ChatPrefsService } from '../chat-prefs/chat-prefs.service';
import { SettingsApiService } from '../settings/settings-api.service';

export interface Chat { id: number; agentId: number; projectSlug: string | null; title: string; updatedAt: Date; model: string; effort: string; addDirs: string[]; allowTools: string[]; yolo: boolean }
export interface ChatMessage { id: number; role: ChatRole; text: string; at: Date }

/** Mensagens agrupadas para a tela: falas, e os passos (ferramentas) entre elas viram um bloco recolhível. */
export type ChatItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'steps'; id: number; steps: ChatMessage[] };

const toChat = (d: ChatDto): Chat => ({
  id: d.id, agentId: d.agent_id, projectSlug: d.project_slug, title: d.title, updatedAt: new Date(d.updated_at), model: d.model ?? '', effort: d.effort ?? '',
  addDirs: list(d.add_dirs), allowTools: list(d.allow_tools), yolo: !!d.yolo,
});
const list = (v: string | null | undefined): string[] => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
const toMessage = (d: ChatMessageDto): ChatMessage => ({ id: d.id, role: d.role, text: d.text, at: new Date(d.at) });

/** Uma conversa aberta na tela: a do painel/tela Agentes (o próprio ChatService) ou a de uma aba de sessão do projeto. */
export class ChatSession {
  /** agente da conversa atual (ou da próxima conversa nova) */
  readonly agentId = signal<number | null>(null);
  readonly current = signal<number | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly error = signal<string | null>(null);
  /** modelo e nível de raciocínio desta conversa (vão com cada mensagem; '' = padrão) */
  readonly model = signal('');
  readonly effort = signal('');
  /** onde achar a conversa salva (para trazer o modelo e o raciocínio dela) e o padrão para conversas novas */
  lookup: (id: number) => Chat | undefined = () => undefined;
  defaults: () => { model: string; effort: string } = () => ({ model: '', effort: '' });
  /** avisado quando uma conversa nova ganha id (a aba da sessão guarda o id) */
  onCreated: (chatId: number) => void = () => {};
  reload: () => void = () => {};

  readonly agent = computed(() => {
    const id = this.agentId();
    return (id ? this.agents.byId().get(id) : null) ?? this.agents.central();
  });
  readonly currentBusy = computed(() => this.current() !== null && this.busy().has(this.current()!));
  /** resposta sendo escrita nesta conversa (vazio = nada ao vivo) */
  readonly streaming = computed(() => { const id = this.current(); return id ? this.streams().get(id) ?? '' : ''; });
  readonly items = computed<ChatItem[]>(() => {
    const out: ChatItem[] = [];
    for (const m of this.messages()) {
      const last = out.at(-1);
      if (m.role === 'tool') {
        if (last?.kind === 'steps') last.steps.push(m);
        else out.push({ kind: 'steps', id: m.id, steps: [m] });
      } else out.push({ kind: 'message', message: m });
    }
    return out;
  });

  constructor(
    protected readonly api: ChatApiService,
    protected readonly agents: AgentsService,
    readonly busy: WritableSignal<Set<number>>,
    /** texto sendo escrito agora, por conversa (compartilhado) */
    readonly streams: WritableSignal<ReadonlyMap<number, string>>,
    /** mensagens já carregadas, por conversa (compartilhado): trocar de aba não busca de novo */
    protected readonly cache: Map<number, ChatMessage[]>,
    /** conversa de sessão de projeto: trabalha na pasta e edita código */
    readonly projectSlug: string | null = null,
  ) {}

  select(chatId: number | null): void {
    this.current.set(chatId);
    this.error.set(null);
    const saved = chatId ? this.lookup(chatId) : undefined;
    const d = saved ?? this.defaults();
    this.model.set(d.model);
    this.effort.set(d.effort);
    const cached = chatId ? this.cache.get(chatId) : null;
    this.messages.set(cached ?? []);
    if (chatId && !cached) this.fetch(chatId);
  }

  private fetch(chatId: number): void {
    this.api.messages(chatId).then(list => {
      const msgs = list.map(toMessage);
      this.cache.set(chatId, msgs);
      if (this.current() === chatId) this.messages.set(msgs);
    });
  }

  newChat(agentId = this.agent()?.id ?? null): void {
    if (agentId) this.agentId.set(agentId);
    this.select(null);
  }

  /** Mensagem nova chegou (o serviço já pôs no cache): a conversa aberta mostra. */
  receive(chatId: number): void {
    const cached = this.cache.get(chatId);
    if (chatId === this.current() && cached) this.messages.set(cached);
  }

  async send(text: string): Promise<void> {
    const agent = this.agent();
    if (!agent) return;
    this.error.set(null);
    try {
      const id = await this.api.send(this.current(), agent.id, text, this.projectSlug, { model: this.model(), effort: this.effort() });
      if (this.current() !== id) {
        this.current.set(id);
        this.onCreated(id);
        this.fetch(id);
      }
      this.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  stop(): void {
    const id = this.current();
    if (id) this.api.stop(id);
  }

  /** libera nesta conversa o que o Claude pediu (pasta ou comando); vale da próxima vez que ele abrir */
  async grant(kind: 'dir' | 'tool', value: string): Promise<void> {
    const id = this.current();
    if (!id) return;
    try { await this.api.grant(id, kind, value); this.reload(); } catch (e) { this.error.set(errorMessage(e)); }
  }

  async setYolo(on: boolean): Promise<void> {
    const id = this.current();
    if (!id) return;
    try { await this.api.yolo(id, on); this.reload(); } catch (e) { this.error.set(errorMessage(e)); }
  }
}

/**
 * Conversas com os agentes. A conversa "atual" é compartilhada entre o painel (Ctrl+J) e a tela Agentes,
 * para continuar de onde estava em qualquer lugar. As abas de sessão dos projetos criam a sua com spawn().
 */
@Injectable({ providedIn: 'root' })
export class ChatService extends ChatSession {
  readonly open = signal(false);
  readonly chats = signal<Chat[]>([]);
  /** texto para pré-preencher a caixa de mensagem (ex.: contexto de uma tarefa) */
  readonly draft = signal<string | null>(null);
  private readonly live = new Set<ChatSession>([this]);
  private readonly prefs = inject(ChatPrefsService);
  private readonly settings = inject(SettingsApiService);
  /** última conversa aberta (no painel ou na tela Agentes) e a última de cada agente: lembradas entre aberturas */
  private last: { agentId: number | null; chatId: number | null; byAgent: Record<number, number> } = { agentId: null, chatId: null, byAgent: {} };
  private readonly ready: Promise<void>;

  readonly agentChats = computed(() => this.chats().filter(c => c.agentId === this.agent()?.id && !c.projectSlug));
  projectChats(slug: string) { return this.chats().filter(c => c.projectSlug === slug); }

  constructor() {
    super(inject(ChatApiService), inject(AgentsService), signal(new Set<number>()), signal(new Map()), new Map());
    this.reload = () => this.loadChats();
    this.wire(this);
    this.api.onStream(({ chat_id, text }) => {
      const m = new Map(this.streams());
      if (text) m.set(chat_id, text); else m.delete(chat_id);
      this.streams.set(m);
    });
    this.api.onEvent(({ chat_id, message, busy }) => {
      this.busy.update(s => { const n = new Set(s); if (busy) n.add(chat_id); else n.delete(chat_id); return n; });
      // uma vez no cache (novo array: quem mostra percebe a mudança), depois cada conversa aberta atualiza
      const cached = this.cache.get(chat_id);
      if (message && cached && !cached.some(m => m.id === message.id)) {
        this.cache.set(chat_id, [...cached, toMessage(message)]);
        for (const s of this.live) s.receive(chat_id);
      }
      // terminou, ou é uma conversa que a lista ainda não conhece (aberta pelo MCP, triagem, outro lugar)
      if (!busy || !this.chats().some(c => c.id === chat_id)) this.loadChats();
    });
    this.loadChats();
    this.ready = Promise.all([this.settings.get('chat:last'), this.api.list(null)]).then(([v, list]) => {
      this.chats.set(list.map(toChat));
      try { if (v) this.last = { agentId: null, chatId: null, byAgent: {}, ...JSON.parse(v) }; } catch { /* valor antigo */ }
    }, () => {});
  }

  /** Abre onde parou: a última conversa (ou o último agente); sem histórico, a Central. Não troca o que já está aberto. */
  async restoreLast(): Promise<void> {
    await this.ready;
    if (this.agentId()) return;
    const { chatId, agentId } = this.last;
    if (chatId && this.chats().some(c => c.id === chatId)) this.select(chatId);
    else if (agentId && this.agents.byId().get(agentId)) this.selectAgent(agentId);
    else if (this.agents.central()) this.selectAgent(this.agents.central()!.id);
  }

  private remember(agentId: number, chatId: number | null): void {
    if (chatId) this.last.byAgent = { ...this.last.byAgent, [agentId]: chatId };
    this.last = { ...this.last, agentId, chatId };
    this.settings.set('chat:last', JSON.stringify(this.last));
  }

  /** Conversa independente (aba de sessão do projeto). Chame release() quando a aba fechar. */
  spawn(projectSlug: string | null): ChatSession {
    const s = new ChatSession(this.api, this.agents, this.busy, this.streams, this.cache, projectSlug);
    s.reload = () => this.loadChats();
    this.wire(s);
    this.live.add(s);
    return s;
  }

  release(s: ChatSession): void { this.live.delete(s); }

  /** a conversa acha o modelo/raciocínio salvos e usa o último escolhido como padrão das novas */
  private wire(s: ChatSession): void {
    s.lookup = id => this.chats().find(c => c.id === id);
    s.defaults = () => this.prefs.prefs().chatDefaults ?? { model: '', effort: '' };
  }

  toggle(): void { this.open.update(o => !o); }

  loadChats(): void {
    this.api.list(null).then(list => this.chats.set(list.map(toChat)));
  }

  /** Muda de agente: mostra a última conversa que você abriu com ele (ou a mais recente, ou uma nova). */
  selectAgent(agentId: number): void {
    if (this.agentId() === agentId && this.current() && this.chats().find(c => c.id === this.current())?.agentId === agentId) return;
    this.agentId.set(agentId);
    const seen = this.last.byAgent[agentId];
    const chatId = seen && this.chats().some(c => c.id === seen && c.agentId === agentId) ? seen : this.chats().find(c => c.agentId === agentId && !c.projectSlug)?.id ?? null;
    this.select(chatId);
    if (!chatId) this.remember(agentId, null);
  }

  override select(chatId: number | null): void {
    const chat = chatId ? this.chats().find(c => c.id === chatId) : null;
    if (chat) this.agentId.set(chat.agentId);
    super.select(chatId);
    if (chat && !chat.projectSlug) this.remember(chat.agentId, chat.id);
  }

  /** Abre o painel numa conversa nova com o agente, com o texto já escrito para o Gustavo completar. */
  compose(agentId: number, text: string): void {
    this.newChat(agentId);
    this.draft.set(text);
    this.open.set(true);
  }

  /**
   * Conversa nova "por trás" (sem trocar a conversa aberta no painel): o agente começa a trabalhar e ela fica no histórico.
   * Devolve o id da conversa.
   */
  async startBackground(agentId: number, text: string): Promise<number> {
    try {
      const d = this.prefs.prefs().chatDefaults ?? { model: '', effort: '' };
      const id = await this.api.send(null, agentId, text, null, d);
      this.loadChats();
      return id;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  /** Manda mensagem numa conversa que já existe, sem abri-la. */
  async sendTo(chatId: number, agentId: number, text: string): Promise<void> {
    try { await this.api.send(chatId, agentId, text, null, null); this.loadChats(); }
    catch (e) { throw new Error(errorMessage(e)); }
  }

  /** Última resposta do agente numa conversa (null se ainda não respondeu). */
  async lastReply(chatId: number): Promise<string | null> {
    const list = await this.api.messages(chatId);
    return [...list].reverse().find(m => m.role === 'assistant')?.text ?? null;
  }

  /** Abre uma conversa no painel lateral (Ctrl+J). */
  openInPanel(chatId: number): void {
    this.select(chatId);
    this.open.set(true);
  }

  /** Continua a sessão de uma execução já terminada. Devolve o id da conversa. */
  async fromRun(runId: number): Promise<number> {
    try {
      const id = await this.api.fromRun(runId);
      await this.api.list(null).then(list => this.chats.set(list.map(toChat)));
      this.select(id);
      return id;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  async rename(chatId: number, title: string): Promise<void> {
    await this.api.rename(chatId, title);
    this.loadChats();
  }

  async remove(chatId: number): Promise<void> {
    await this.api.remove(chatId);
    this.cache.delete(chatId);
    if (this.current() === chatId) this.select(null);
    this.loadChats();
  }
}
