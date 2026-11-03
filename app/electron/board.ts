/**
 * Quadro (workflow) por projeto/frente: colunas livres, cada uma de um tipo que a Central entende (backlog, todo, doing,
 * review, dev, done), com descrição e, opcionalmente, um agente que pega o que entra nela e para onde a tarefa vai quando
 * ele termina. A tarefa guarda a coluna (stage) e o tipo (column): tudo que já existia segue lendo o tipo.
 * Projeto sem colunas = quadro padrão (os tipos fixos).
 */
import type { BoardColumnDto, TaskColumn } from '../src/app/shared/contract';
import { all, get, now, run } from './db';

export const KINDS: TaskColumn[] = ['backlog', 'todo', 'doing', 'review', 'dev', 'done'];
const KIND_LABEL: Record<TaskColumn, string> = { backlog: 'fila', todo: 'a fazer', doing: 'fazendo', review: 'revisão', dev: 'em dev', done: 'feito' };

export const listBoard = (slug: string) =>
  all<BoardColumnDto>('select key, label, description, kind, agent_id, instruction, parallel, hours, next_key from board_columns where project_slug = ? order by position', slug);

export const hasBoard = (slug: string | null) => !!slug && !!get('select 1 from board_columns where project_slug = ?', slug);

const columnOf = (slug: string, key: string) => listBoard(slug).find(c => c.key === key) ?? null;

/** primeira coluna do tipo (para quem move pelo tipo: execução terminou, PR mergeado, agente com column=review) */
export function stageFor(slug: string, kind: TaskColumn): string | null {
  const cols = listBoard(slug);
  return (cols.find(c => c.kind === kind) ?? null)?.key ?? null;
}

/** "Revisão por agente" → "revisao-por-agente" */
export const keyOf = (label: string) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'coluna';

/** Põe a tarefa numa coluna do quadro (o tipo acompanha). */
export function setStage(taskId: number, key: string, prUrl: string | null = null): void {
  const t = get<{ project_slug: string }>('select project_slug from tasks where id = ?', taskId);
  if (!t) throw new Error('Tarefa não encontrada.');
  const col = columnOf(t.project_slug, key);
  if (!col) throw new Error(`Coluna "${key}" não existe no quadro deste projeto.`);
  run(`update tasks set stage = ?, "column" = ?, pr_url = coalesce(?, pr_url), updated_at = ? where id = ?`, col.key, col.kind, prUrl, now(), taskId);
}

/** Acha a coluna pelo key ou pelo nome (agentes falam "Revisão por agente"). */
export function resolveStage(slug: string, keyOrLabel: string): string | null {
  const cols = listBoard(slug);
  const k = keyOf(keyOrLabel);
  return (cols.find(c => c.key === keyOrLabel) ?? cols.find(c => c.key === k) ?? cols.find(c => c.label.toLowerCase() === keyOrLabel.trim().toLowerCase()))?.key ?? null;
}

export interface BoardColumnInput {
  key?: string; label: string; description?: string | null; kind: TaskColumn;
  agent_id?: number | null; instruction?: string | null; parallel?: number; hours?: string; next_key?: string | null;
}

/**
 * Troca o quadro inteiro. Tarefas numa coluna que sumiu vão para a primeira coluna do mesmo tipo (ou a primeira).
 * Lista vazia = volta ao quadro padrão (stage some, o tipo fica).
 */
export function saveBoard(slug: string, input: BoardColumnInput[]): BoardColumnDto[] {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error('Projeto não encontrado.');
  const used = new Set<string>();
  const cols = input.map((c, i) => {
    const label = c.label?.trim();
    if (!label) throw new Error(`A coluna ${i + 1} está sem nome.`);
    if (!KINDS.includes(c.kind)) throw new Error(`Tipo inválido na coluna "${label}".`);
    let key = keyOf(c.key || label);
    for (let n = 2; used.has(key); n++) key = `${keyOf(c.key || label)}-${n}`;
    used.add(key);
    if (c.agent_id && !get('select 1 from agents where id = ?', c.agent_id)) throw new Error(`Agente não encontrado na coluna "${label}".`);
    if (c.hours && !/^\d{1,2}-\d{1,2}$/.test(c.hours.trim())) throw new Error(`Horário no formato 08-22 na coluna "${label}".`);
    return { ...c, key, label, position: i, parallel: Math.min(Math.max(Number(c.parallel) || 1, 1), 4) };
  });
  if (cols.length && !cols.some(c => c.kind === 'done')) throw new Error('O quadro precisa de uma coluna do tipo "feito".');
  for (const c of cols) if (c.next_key && !used.has(keyOf(c.next_key))) throw new Error(`"${c.label}" manda para uma coluna que não existe.`);
  run('begin');
  try {
    run('delete from board_columns where project_slug = ?', slug);
    for (const c of cols) {
      run(`insert into board_columns (project_slug, key, label, description, kind, position, agent_id, instruction, parallel, hours, next_key) values (?,?,?,?,?,?,?,?,?,?,?)`,
        slug, c.key, c.label, c.description?.trim() || null, c.kind, c.position, c.agent_id ?? null, c.instruction?.trim() || null, c.parallel,
        c.hours?.trim() ?? '', c.next_key ? keyOf(c.next_key) : null);
    }
    if (!cols.length) run('update tasks set stage = null where project_slug = ?', slug);
    else {
      for (const t of all<{ id: number; stage: string | null; column: TaskColumn }>(`select id, stage, "column" from tasks where project_slug = ?`, slug)) {
        if (t.stage && used.has(t.stage)) continue;
        const to = cols.find(c => c.kind === t.column) ?? cols[0];
        run(`update tasks set stage = ?, "column" = ? where id = ?`, to.key, to.kind, t.id);
      }
    }
    run('commit');
  } catch (e) { run('rollback'); throw e; }
  return listBoard(slug);
}

/** Para os prompts: o quadro do projeto, para o agente saber o que cada coluna significa. */
export function boardBlock(slug: string): string {
  const cols = listBoard(slug);
  if (!cols.length) return '';
  const agent = (id: number | null) => (id ? get<{ name: string }>('select name from agents where id = ?', id)?.name ?? null : null);
  return ['## Quadro deste projeto (mova tarefas com update_task stage=<coluna>)',
    ...cols.map(c => `- ${c.label} [${c.key}, ${KIND_LABEL[c.kind]}]${c.description ? `: ${c.description}` : ''}${agent(c.agent_id) ? ` (quem cuida: ${agent(c.agent_id)}${c.next_key ? `, depois vai para ${c.next_key}` : ''})` : ''}`),
  ].join('\n');
}
