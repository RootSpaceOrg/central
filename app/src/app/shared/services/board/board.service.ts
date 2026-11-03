import { Injectable, inject, signal } from '@angular/core';

import { BoardColumnDto, TaskColumn } from '../../contract';
import { IpcService, errorMessage } from '../ipc/ipc.service';

/** Uma coluna do workflow de um projeto. */
export interface BoardColumn {
  key: string;
  label: string;
  description: string | null;
  /** o que a coluna significa para a Central */
  kind: TaskColumn;
  /** agente que pega o que entra nela */
  agentId: number | null;
  instruction: string | null;
  parallel: number;
  hours: string;
  /** para onde vai quando o agente termina bem (null = Revisão) */
  nextKey: string | null;
}

export const KIND_LABEL: Record<TaskColumn, string> = {
  backlog: 'Fila', todo: 'A fazer', doing: 'Fazendo', review: 'Revisão', dev: 'Em dev', done: 'Feito',
};

const col = (label: string, kind: TaskColumn, extra: Partial<BoardColumn> = {}): BoardColumn =>
  ({ key: '', label, description: null, kind, agentId: null, instruction: null, parallel: 1, hours: '', nextKey: null, ...extra });

/** Modelos para começar (os agentes você escolhe em cada coluna). */
export const BOARD_TEMPLATES: { id: string; label: string; hint: string; columns: BoardColumn[] }[] = [
  { id: 'dev', label: 'Desenvolvimento', hint: 'O padrão: backlog até feito.', columns: [
    col('Backlog', 'backlog'), col('A fazer', 'todo', { description: 'Pronto para pegar.' }), col('Fazendo', 'doing'),
    col('Revisão', 'review', { description: 'PR aberto esperando seu olhar.' }), col('Feito', 'done')] },
  { id: 'dev-revisor', label: 'Desenvolvimento com revisor', hint: 'Um agente codifica, outro revisa o PR antes de você.', columns: [
    col('Backlog', 'backlog'),
    col('A fazer', 'todo', { description: 'O dev pega daqui.', instruction: 'Implemente a tarefa num worktree, com teste, e abra o PR.', nextKey: 'revisao-tecnica' }),
    col('Fazendo', 'doing'),
    col('Revisão técnica', 'review', { description: 'Um agente revisor olha o PR antes de você.', instruction: 'Revise o PR da tarefa: bugs, segurança, convenções, testes. Comente no PR o que achou. Se estiver bom, diga que está pronto para o Gustavo; se não, liste o que corrigir.', nextKey: 'revisao-final' }),
    col('Revisão final', 'review', { description: 'Seu olhar.' }),
    col('Em dev', 'dev', { description: 'Mergeado em develop, esperando produção.' }),
    col('Feito', 'done', { description: 'Em produção.' })] },
  { id: 'conteudo', label: 'Conteúdo', hint: 'Pesquisa → roteiro → arte → sua revisão → publicado.', columns: [
    col('Ideias', 'backlog', { description: 'O que pode virar conteúdo.' }),
    col('Pesquisa', 'todo', { instruction: 'Pesquise o tema: dados, referências, o que o público pergunta. Escreva o resumo na tarefa.', nextKey: 'roteiro' }),
    col('Roteiro', 'doing', { instruction: 'Escreva o roteiro/texto a partir da pesquisa da tarefa.', nextKey: 'arte' }),
    col('Arte', 'doing', { instruction: 'Descreva ou produza as peças visuais a partir do roteiro.', nextKey: 'revisao' }),
    col('Revisão', 'review', { description: 'Seu olhar antes de publicar.' }),
    col('Publicado', 'done')] },
];

const toModel = (d: BoardColumnDto): BoardColumn => ({
  key: d.key, label: d.label, description: d.description, kind: d.kind, agentId: d.agent_id, instruction: d.instruction,
  parallel: d.parallel, hours: d.hours, nextKey: d.next_key,
});
const toDto = (c: BoardColumn): BoardColumnDto => ({
  key: c.key, label: c.label, description: c.description, kind: c.kind, agent_id: c.agentId, instruction: c.instruction,
  parallel: c.parallel, hours: c.hours, next_key: c.nextKey,
});

/**
 * Quadro (workflow) de cada projeto: colunas livres com tipo, descrição e agente. Vazio = quadro padrão.
 * ponytail: o service fala com o IPC direto (só repassaria uma api de 2 métodos).
 */
@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly ipc = inject(IpcService);

  readonly bySlug = signal<Record<string, BoardColumn[]>>({});

  ensure(slug: string): void { if (!(slug in this.bySlug())) this.load(slug); }

  load(slug: string): void {
    this.ipc.invoke('board:get', slug).then(list => this.bySlug.update(m => ({ ...m, [slug]: list.map(toModel) })));
  }

  async save(slug: string, columns: BoardColumn[]): Promise<void> {
    try {
      const saved = await this.ipc.invoke('board:save', slug, columns.map(toDto));
      this.bySlug.update(m => ({ ...m, [slug]: saved.map(toModel) }));
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }
}
