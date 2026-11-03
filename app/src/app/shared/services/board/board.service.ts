import { Injectable, computed, inject, signal } from '@angular/core';

import { BoardColumnDto, BoardDto, TaskColumn } from '../../contract';
import { IpcService, errorMessage } from '../ipc/ipc.service';

/** Uma coluna de um quadro (workflow). */
export interface BoardColumn {
  key: string;
  label: string;
  description: string | null;
  /** entrar nela põe a tarefa neste estado no backlog principal (null = não mexe) */
  kind: TaskColumn | null;
  /** agente (de qualquer projeto) que pega o que entra nela */
  agentId: number | null;
  instruction: string | null;
  parallel: number;
  hours: string;
  /** para onde vai quando o agente termina bem (null = a próxima coluna) */
  nextKey: string | null;
  /** cor da coluna (null = padrão) */
  color: string | null;
}

/** Quadro (workflow): independente de projeto; uma tarefa pode estar em vários. */
export interface Board {
  id: number;
  name: string;
  description: string | null;
  projectSlug: string | null;
  color: string;
  openTasks: number;
  columns: BoardColumn[];
}

/** Onde uma tarefa está num quadro. */
export interface Placement { taskId: number; boardId: number; stage: string; position: number }

/** Cores para colunas e cartões (null = padrão, sem cor). */
export const COLORS: { value: string; label: string }[] = [
  { value: '#7FA2FF', label: 'Azul' }, { value: '#5FD3B5', label: 'Turquesa' }, { value: '#7ED69A', label: 'Verde' }, { value: '#E8C46A', label: 'Amarelo' },
  { value: '#E8A36A', label: 'Laranja' }, { value: '#F07A7A', label: 'Vermelho' }, { value: '#FF8FB1', label: 'Rosa' }, { value: '#C6A6FF', label: 'Roxo' },
];

export const KIND_LABEL: Record<TaskColumn, string> = {
  backlog: 'Backlog', todo: 'A fazer', doing: 'Fazendo', review: 'Revisão', dev: 'Em dev', done: 'Feito',
};

export const blankColumn = (label = '', extra: Partial<BoardColumn> = {}): BoardColumn =>
  ({ key: '', label, description: null, kind: null, agentId: null, instruction: null, parallel: 1, hours: '', nextKey: null, color: null, ...extra });
const col = blankColumn;

/** Modelos para começar um quadro (os agentes você escolhe em cada coluna). */
export const BOARD_TEMPLATES: { id: string; label: string; hint: string; columns: BoardColumn[] }[] = [
  { id: 'simples', label: 'Simples', hint: 'A fazer → Fazendo → Pronto.', columns: [
    col('A fazer'), col('Fazendo', { kind: 'doing' }), col('Pronto', { kind: 'done' })] },
  { id: 'dev-revisor', label: 'Código com revisor', hint: 'Um agente implementa, outro revisa o PR, você aprova.', columns: [
    col('Pedidos'),
    col('Implementar', { kind: 'doing', description: 'Implementa num worktree, com teste, e abre o PR.', instruction: 'Implemente a tarefa num worktree, com teste, e abra o PR.' }),
    col('Revisão técnica', { kind: 'review', description: 'Um agente revisor olha o PR antes de você.', instruction: 'Revise o PR da tarefa: bugs, segurança, convenções, testes. Comente no PR o que achou e diga se está pronto para o Gustavo.' }),
    col('Sua aprovação', { kind: 'review', description: 'Seu olhar.' }),
    col('Pronto', { kind: 'done' })] },
  { id: 'conteudo', label: 'Conteúdo', hint: 'Pesquisa → roteiro → arte → sua revisão → publicado.', columns: [
    col('Ideias', { description: 'O que pode virar conteúdo.' }),
    col('Pesquisa', { kind: 'doing', instruction: 'Pesquise o tema: dados, referências, o que o público pergunta. Escreva o resumo na tarefa.' }),
    col('Roteiro', { kind: 'doing', instruction: 'Escreva o roteiro/texto a partir da pesquisa da tarefa.' }),
    col('Arte', { kind: 'doing', instruction: 'Descreva ou produza as peças visuais a partir do roteiro.' }),
    col('Sua revisão', { kind: 'review', description: 'Seu olhar antes de publicar.' }),
    col('Publicado', { kind: 'done' })] },
];

const toCol = (d: BoardColumnDto): BoardColumn => ({
  key: d.key, label: d.label, description: d.description, kind: d.kind, agentId: d.agent_id, instruction: d.instruction,
  parallel: d.parallel, hours: d.hours, nextKey: d.next_key, color: d.color ?? null,
});
const toColDto = (c: BoardColumn): BoardColumnDto => ({
  key: c.key, label: c.label, description: c.description, kind: c.kind, agent_id: c.agentId, instruction: c.instruction,
  parallel: c.parallel, hours: c.hours, next_key: c.nextKey, color: c.color,
});
const toBoard = (d: BoardDto): Board => ({
  id: d.id, name: d.name, description: d.description, projectSlug: d.project_slug, color: d.color, openTasks: d.open_tasks, columns: d.columns.map(toCol),
});

/** "Revisão técnica" → "revisao-tecnica" (o mesmo que o backend) */
export const keyOf = (label: string) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'coluna';

/**
 * Quadros e onde cada tarefa está neles. Recarrega quando o backlog muda (agentes movem pelo MCP, execução terminou).
 * ponytail: fala com o IPC direto; uma api só repassaria os mesmos métodos.
 */
@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly ipc = inject(IpcService);

  readonly boards = signal<Board[]>([]);
  readonly placements = signal<Placement[]>([]);
  readonly loaded = signal(false);
  readonly byId = computed(() => new Map(this.boards().map(b => [b.id, b])));
  /** quadros de cada tarefa */
  readonly ofTask = computed(() => {
    const m = new Map<number, Placement[]>();
    for (const p of this.placements()) m.set(p.taskId, [...(m.get(p.taskId) ?? []), p]);
    return m;
  });

  constructor() {
    this.load();
    this.ipc.on('backlog:changed', () => this.load());
  }

  load(): void {
    Promise.all([this.ipc.invoke('boards:list'), this.ipc.invoke('boards:stages')]).then(([b, p]) => {
      this.boards.set(b.map(toBoard));
      this.placements.set(p.map(x => ({ taskId: x.task_id, boardId: x.board_id, stage: x.stage, position: x.position })));
      this.loaded.set(true);
    });
  }

  /** "Conteúdo · Roteiro" */
  label(p: Placement): string {
    const b = this.byId().get(p.boardId);
    return `${b?.name ?? 'Quadro'} · ${b?.columns.find(c => c.key === p.stage)?.label ?? p.stage}`;
  }

  async create(name: string, projectSlug: string | null, columns: BoardColumn[], description: string | null = null): Promise<Board> {
    return this.call(async () => toBoard(await this.ipc.invoke('boards:create', { name, description, project_slug: projectSlug, columns: columns.map(toColDto) })));
  }

  update(id: number, patch: { name?: string; description?: string | null; project_slug?: string | null; color?: string }): Promise<void> {
    return this.call(() => this.ipc.invoke('boards:update', id, patch));
  }

  remove(id: number): Promise<void> { return this.call(() => this.ipc.invoke('boards:delete', id)); }

  saveColumns(id: number, columns: BoardColumn[]): Promise<void> {
    // keys estáveis para as que já existiam; as novas nascem do nome (sem repetir)
    const used = new Set<string>();
    const cols = columns.map(c => {
      let k = c.key || keyOf(c.label);
      for (let n = 2; used.has(k); n++) k = `${c.key || keyOf(c.label)}-${n}`;
      used.add(k);
      return { ...c, key: k };
    });
    this.boards.update(list => list.map(b => (b.id === id ? { ...b, columns: cols } : b)));
    return this.call(async () => { await this.ipc.invoke('boards:columns', id, cols.map(toColDto)); });
  }

  /** põe ou move a tarefa numa coluna do quadro */
  place(taskId: number, boardId: number, stage: string, position = 0): void {
    this.placements.update(list => [...list.filter(p => !(p.taskId === taskId && p.boardId === boardId)), { taskId, boardId, stage, position }]);
    this.ipc.invoke('boards:place', taskId, boardId, stage, position).catch(() => this.load());
  }

  unplace(taskId: number, boardId: number): void {
    this.placements.update(list => list.filter(p => !(p.taskId === taskId && p.boardId === boardId)));
    this.ipc.invoke('boards:remove', taskId, boardId).catch(() => this.load());
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try { const r = await fn(); this.load(); return r; }
    catch (e) { this.load(); throw new Error(errorMessage(e)); }
  }
}
