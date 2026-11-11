import { Injectable, inject, signal } from '@angular/core';

import { DeliveryDto, DeliveryStatus, DigestDto } from '../../contract';
import { ChatService } from '../chat/chat.service';
import { IpcService, errorMessage } from '../ipc/ipc.service';
import { DeliveriesApiService } from './deliveries-api.service';

/** O que uma execução entregou: a nota do agente + o diff + a revisão. */
export interface Delivery {
  id: number;
  runId: number;
  projectSlug: string | null;
  projectName: string | null;
  agentId: number | null;
  agentName: string | null;
  taskId: number | null;
  title: string;
  what: string;
  why: string | null;
  howToTest: string | null;
  /** vídeo do fluxo (url que a tela toca) */
  video: string | null;
  risks: string | null;
  /** o agente contou; false = a Central montou do resultado */
  explained: boolean;
  failed: boolean;
  prUrl: string | null;
  files: number;
  additions: number;
  deletions: number;
  diffStat: string | null;
  status: DeliveryStatus;
  reviewNote: string | null;
  at: Date;
}

/** Tudo o que aconteceu desde a última visita. */
export interface Digest {
  since: Date;
  deliveries: Delivery[];
  tasksDone: { id: number; title: string; projectSlug: string }[];
  roadmap: { kind: string; title: string; detail: string | null; author: string; at: Date; projectSlug: string }[];
  ideas: number;
  decisions: number;
  memories: number;
  runs: number;
  minutes: number;
  costUsd: number;
}

const toModel = (d: DeliveryDto): Delivery => ({
  id: d.id, runId: d.run_id, projectSlug: d.project_slug, projectName: d.project_name, agentId: d.agent_id, agentName: d.agent_name,
  taskId: d.task_id, title: d.title, what: d.what, why: d.why, howToTest: d.how_to_test, video: d.video ? `central-media://v/${encodeURIComponent(d.video)}` : null, risks: d.risks, explained: d.explained,
  failed: d.outcome === 'failed', prUrl: d.pr_url, files: d.files, additions: d.additions, deletions: d.deletions, diffStat: d.diff_stat,
  status: d.status, reviewNote: d.review_note, at: new Date(d.created_at),
});

const toDigest = (d: DigestDto): Digest => ({
  since: new Date(d.since), deliveries: d.deliveries.map(toModel),
  tasksDone: d.tasks_done.map(t => ({ id: t.id, title: t.title, projectSlug: t.project_slug })),
  roadmap: d.roadmap.map(e => ({ kind: e.kind, title: e.title, detail: e.detail, author: e.author, at: new Date(e.at), projectSlug: e.project_slug })),
  ideas: d.ideas, decisions: d.decisions, memories: d.memories, runs: d.runs, minutes: d.minutes, costUsd: d.cost_usd,
});

/** Entregas para revisar e o resumo de quando você estava fora. */
@Injectable({ providedIn: 'root' })
export class DeliveriesService {
  private readonly api = inject(DeliveriesApiService);
  private readonly chat = inject(ChatService);
  private readonly ipc = inject(IpcService);

  /** fila de revisão: entregas que mexeram em código e esperam você */
  readonly queue = signal<Delivery[]>([]);
  /** tela Revisão: a fila + a nota mais recente de cada tarefa em Revisão no backlog */
  readonly board = signal<Delivery[]>([]);
  readonly error = signal<string | null>(null);
  /** muda a cada novidade (execução terminou, entrega, revisão): quem mostra o digest recarrega */
  readonly changed = signal(0);

  constructor() {
    this.load();
    this.api.onChanged(() => { this.load(); this.changed.update(n => n + 1); });
  }

  load(): void {
    this.api.list(null, 'review').then(list => this.queue.set(list.map(toModel)));
    this.api.board().then(list => this.board.set(list.map(toModel)));
  }

  async digest(since: Date): Promise<Digest> { return toDigest(await this.api.digest(since.toISOString())); }

  accept(d: Delivery): void { this.review(d, 'accepted', null); }
  discard(d: Delivery): void { this.review(d, 'discarded', null); }

  /** Pedir ajuste: continua a sessão da execução (mesma pasta e contexto) com o seu texto. Devolve a conversa. */
  /** devolve a conversa só no caminho antigo (execução sem sessão); senão a própria execução roda de novo */
  async adjust(d: Delivery, text: string): Promise<number | null> {
    try {
      if (await this.ipc.invoke('deliveries:adjust', d.id, text)) {
        this.queue.update(q => q.filter(x => x.id !== d.id));
        this.board.update(q => q.filter(x => x.id !== d.id));
        return null;
      }
      const chatId = await this.chat.fromRun(d.runId);
      const agentId = this.chat.chats().find(c => c.id === chatId)?.agentId ?? d.agentId;
      if (agentId) await this.chat.sendTo(chatId, agentId, `Ajuste pedido pelo Gustavo na entrega "${d.title}":\n\n${text}\n\nFaça o ajuste, rode o que for preciso e, se houver PR, atualize-o.`);
      this.review(d, 'adjusting', text);
      return chatId;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  private review(d: Delivery, action: 'accepted' | 'adjusting' | 'discarded', note: string | null): void {
    this.queue.update(q => q.filter(x => x.id !== d.id));
    this.board.update(q => q.filter(x => x.id !== d.id));
    this.api.review(d.id, action, note).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }
}
