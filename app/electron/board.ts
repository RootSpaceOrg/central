/**
 * Quadros (workflows): independentes de projeto. Uma tarefa vive no backlog principal do projeto dela (as colunas fixas:
 * backlog, a fazer, fazendo, revisão, em dev, feito) e pode estar em N quadros ao mesmo tempo, numa coluna de cada.
 * Cada coluna pode ter um agente (de qualquer projeto) que pega o que entra nela e, ao terminar bem, a tarefa segue para
 * a próxima coluna. Uma coluna pode refletir no backlog principal (kind: entrar nela põe a tarefa naquele estado).
 * Quadro com projeto aparece no projeto; sem projeto, é um fluxo solto (pedidos podem nem ter projeto).
 */
import type { BoardColumnDto, BoardDto, TaskColumn } from '../src/app/shared/contract';
import { all, get, now, run } from './db';

export const KINDS: TaskColumn[] = ['backlog', 'todo', 'doing', 'review', 'dev', 'done'];
const KIND_LABEL: Record<TaskColumn, string> = { backlog: 'backlog', todo: 'a fazer', doing: 'fazendo', review: 'revisão', dev: 'em dev', done: 'feito' };

/** "Revisão técnica" → "revisao-tecnica" */
/** cor válida (#rrggbb) ou null = padrão */
export const color = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);

export const keyOf = (label: string) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'coluna';

export const listColumns = (boardId: number) =>
  all<BoardColumnDto>('select key, label, description, kind, agent_id, instruction, parallel, hours, next_key, color from board_cols where board_id = ? order by position', boardId);

export const listBoards = (): BoardDto[] => all<Omit<BoardDto, 'columns'>>(`
    select b.id, b.name, b.description, b.project_slug, b.color, b.position, b.created_at,
      (select count(*) from task_boards x join tasks t on t.id = x.task_id where x.board_id = b.id and t."column" <> 'done') open_tasks
    from boards b order by b.position, b.id`).map(b => ({ ...b, columns: listColumns(b.id) }));

const board = (id: number) => listBoards().find(b => b.id === id) ?? null;

/** Acha o quadro pelo id ou pelo nome (agentes falam "Conteúdo"). */
export function resolveBoard(idOrName: number | string): number | null {
  if (typeof idOrName === 'number' || /^\d+$/.test(String(idOrName))) return get<{ id: number }>('select id from boards where id = ?', Number(idOrName))?.id ?? null;
  // nome repetido: não adivinha (pegar o primeiro mandou tarefas para o quadro antigo); pede o id
  const same = byName(String(idOrName));
  if (same.length > 1) throw new Error(`Há ${same.length} quadros chamados "${String(idOrName).trim()}" (${same.map(b => `#${b.id}${b.project_slug ? ` em ${b.project_slug}` : ''}`).join(', ')}): use o id.`);
  return same[0]?.id ?? null;
}

/** quadros com esse nome, sem diferenciar maiúscula (o lower() do SQLite não entende acento: "CONTEÚDO" ≠ "conteúdo") */
const norm = (n: string) => n.trim().toLocaleLowerCase('pt-BR');
const byName = (name: string) => all<{ id: number; name: string; project_slug: string | null }>('select id, name, project_slug from boards order by id')
  .filter(b => norm(b.name) === norm(name));

/** nome de quadro é único (agentes acham o quadro pelo nome) */
function checkName(name: string, except: number | null = null): void {
  const other = byName(name).find(b => b.id !== except);
  if (other) throw new Error(`Já existe um quadro "${name.trim()}" (#${other.id}). Use esse, ou dê outro nome.`);
}

/** Acha a coluna pelo key ou pelo nome. */
export function resolveStage(boardId: number, keyOrLabel: string): string | null {
  const cols = listColumns(boardId);
  const k = keyOf(keyOrLabel);
  return (cols.find(c => c.key === keyOrLabel) ?? cols.find(c => c.key === k) ?? cols.find(c => c.label.toLowerCase() === keyOrLabel.trim().toLowerCase()))?.key ?? null;
}

export function createBoard(i: { name: string; description?: string | null; project_slug?: string | null; color?: string; columns?: BoardColumnInput[] }): BoardDto {
  const name = i.name?.trim();
  if (!name) throw new Error('Dê um nome ao quadro.');
  checkName(name);
  if (i.project_slug && !get('select 1 from projects where slug = ?', i.project_slug)) throw new Error('Projeto não encontrado.');
  const pos = (get<{ p: number | null }>('select max(position) p from boards')?.p ?? -1) + 1;
  const id = Number(run('insert into boards (name, description, project_slug, color, position) values (?,?,?,?,?)',
    name, i.description?.trim() || null, i.project_slug || null, i.color || '#7FA2FF', pos).lastInsertRowid);
  saveColumns(id, i.columns?.length ? i.columns : [{ label: 'A fazer', kind: 'todo' }, { label: 'Fazendo', kind: 'doing' }, { label: 'Pronto', kind: 'done' }]);
  return board(id)!;
}

export function updateBoard(id: number, patch: { name?: string; description?: string | null; project_slug?: string | null; color?: string }): void {
  if (!get('select 1 from boards where id = ?', id)) throw new Error('Quadro não encontrado.');
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Dê um nome ao quadro.');
  if (patch.name !== undefined) checkName(patch.name, id);
  if (patch.project_slug && !get('select 1 from projects where slug = ?', patch.project_slug)) throw new Error('Projeto não encontrado.');
  const f = (['name', 'description', 'project_slug', 'color'] as const).filter(k => patch[k] !== undefined);
  if (f.length) run(`update boards set ${f.map(k => `${k} = ?`).join(', ')} where id = ?`, ...f.map(k => (typeof patch[k] === 'string' ? (patch[k] as string).trim() || null : patch[k] ?? null)), id);
}

/** Apaga o quadro; as tarefas continuam (só saem dele). */
export function deleteBoard(id: number): void {
  run('delete from task_boards where board_id = ?', id);
  run('delete from board_cols where board_id = ?', id);
  run('delete from boards where id = ?', id);
}

export interface BoardColumnInput {
  key?: string; label: string; description?: string | null; kind?: TaskColumn | null;
  agent_id?: number | null; instruction?: string | null; parallel?: number; hours?: string; next_key?: string | null; color?: string | null;
}

/** Troca as colunas do quadro. Tarefas numa coluna que sumiu vão para a primeira. */
export function saveColumns(boardId: number, input: BoardColumnInput[]): BoardColumnDto[] {
  if (!get('select 1 from boards where id = ?', boardId)) throw new Error('Quadro não encontrado.');
  if (!input.length) throw new Error('O quadro precisa de pelo menos uma coluna.');
  const used = new Set<string>();
  const cols = input.map((c, i) => {
    const label = c.label?.trim();
    if (!label) throw new Error(`A coluna ${i + 1} está sem nome.`);
    if (c.kind && !KINDS.includes(c.kind)) throw new Error(`Tipo inválido na coluna "${label}".`);
    let key = keyOf(c.key || label);
    for (let n = 2; used.has(key); n++) key = `${keyOf(c.key || label)}-${n}`;
    used.add(key);
    if (c.agent_id && !get('select 1 from agents where id = ?', c.agent_id)) throw new Error(`Agente não encontrado na coluna "${label}".`);
    if (c.hours && !/^\d{1,2}-\d{1,2}$/.test(c.hours.trim())) throw new Error(`Horário no formato 08-22 na coluna "${label}".`);
    return { ...c, key, label, position: i, parallel: Math.min(Math.max(Number(c.parallel) || 1, 1), 4) };
  });
  for (const c of cols) if (c.next_key && !used.has(keyOf(c.next_key))) throw new Error(`"${c.label}" manda para uma coluna que não existe.`);
  run('begin');
  try {
    run('delete from board_cols where board_id = ?', boardId);
    for (const c of cols) {
      run(`insert into board_cols (board_id, key, label, description, kind, position, agent_id, instruction, parallel, hours, next_key, color) values (?,?,?,?,?,?,?,?,?,?,?,?)`,
        boardId, c.key, c.label, c.description?.trim() || null, c.kind ?? null, c.position, c.agent_id ?? null, c.instruction?.trim() || null, c.parallel,
        c.hours?.trim() ?? '', c.next_key ? keyOf(c.next_key) : null, color(c.color));
    }
    run(`update task_boards set stage = ? where board_id = ? and stage not in (${[...used].map(() => '?').join(',')})`, cols[0].key, boardId, ...used);
    run('commit');
  } catch (e) { run('rollback'); throw e; }
  return listColumns(boardId);
}

const toInput = (c: BoardColumnDto): BoardColumnInput => ({
  key: c.key, label: c.label, description: c.description, kind: c.kind, agent_id: c.agent_id, instruction: c.instruction,
  parallel: c.parallel, hours: c.hours, next_key: c.next_key, color: c.color ?? null,
});

/** Coluna nova (sem mexer nas outras nem nas tarefas): depois de "after" (nome ou key), ou no fim. */
export function addColumn(boardId: number, col: BoardColumnInput, after?: string | null): BoardColumnDto[] {
  const cols = listColumns(boardId).map(toInput);
  const at = after ? cols.findIndex(c => c.key === (resolveStage(boardId, after) ?? '')) : -1;
  if (after && at < 0) throw new Error(`Coluna "${after}" não existe neste quadro.`);
  cols.splice(at < 0 ? cols.length : at + 1, 0, col);
  return saveColumns(boardId, cols);
}

/** Edita uma coluna (nome, agente, instrução, tipo, para onde vai depois); as tarefas ficam onde estão. */
export function patchColumn(boardId: number, column: string, patch: Partial<BoardColumnInput>): BoardColumnDto[] {
  const key = resolveStage(boardId, column);
  if (!key) throw new Error(`Coluna "${column}" não existe neste quadro.`);
  return saveColumns(boardId, listColumns(boardId).map(toInput).map(c => (c.key === key ? { ...c, ...patch, key } : c)));
}

/**
 * Põe (ou move) a tarefa numa coluna do quadro. Se a coluna reflete no backlog principal (kind), a tarefa vai junto
 * para aquele estado lá.
 */
export function setStage(taskId: number, boardId: number, key: string, position = 0): void {
  const col = listColumns(boardId).find(c => c.key === key);
  if (!col) throw new Error(`Coluna "${key}" não existe neste quadro.`);
  // alguém (o agente da etapa, outro agente ou você) mexeu no cartão durante a execução: no fim ela não avança por cima
  run(`update runs set board_moved = 1 where task_id = ? and board_id = ? and status in ('queued','preparing','running')`, taskId, boardId);
  if (!get('select 1 from tasks where id = ?', taskId)) throw new Error('Tarefa não encontrada.');
  run(`insert into task_boards (task_id, board_id, stage, position, updated_at) values (?,?,?,?,?)
       on conflict (task_id, board_id) do update set stage = excluded.stage, position = excluded.position, updated_at = excluded.updated_at`,
    taskId, boardId, key, position, now());
  if (col.kind) run(`update tasks set "column" = ?, updated_at = ? where id = ?`, col.kind, now(), taskId);
}

export const removeFromBoard = (taskId: number, boardId: number) => { run('delete from task_boards where task_id = ? and board_id = ?', taskId, boardId); };

/** Onde a tarefa está nos quadros (para o card, o diálogo e o MCP). */
export const stagesOf = () => all<{ task_id: number; board_id: number; stage: string; position: number }>('select task_id, board_id, stage, position from task_boards');

/** Coluna seguinte (a escolhida, ou a próxima na ordem; null = já é a última). */
export function nextStage(boardId: number, key: string): string | null {
  const cols = listColumns(boardId);
  const i = cols.findIndex(c => c.key === key);
  if (i < 0) return null;
  return cols[i].next_key ?? cols[i + 1]?.key ?? null;
}

/** Para os prompts: os quadros do projeto (e os que o agente atende), com o que cada coluna significa. */
export function boardBlock(boardIds: number[]): string {
  const boards = listBoards().filter(b => boardIds.includes(b.id));
  if (!boards.length) return '';
  const agent = (id: number | null) => (id ? get<{ name: string }>('select name from agents where id = ?', id)?.name ?? null : null);
  return ['## Quadros (workflows) em que você atua (mova tarefas com move_on_board)',
    ...boards.map(b => `### ${b.name} [#${b.id}]${b.description ? `: ${b.description}` : ''}\n${b.columns.map(c =>
      `- ${c.label} [${c.key}]${c.description ? `: ${c.description}` : ''}${agent(c.agent_id) ? ` (quem cuida: ${agent(c.agent_id)})` : ''}${c.kind ? ` · no backlog principal: ${KIND_LABEL[c.kind]}` : ''}`).join('\n')}`),
  ].join('\n');
}

/** Quadros ligados a um projeto (ou onde há tarefas dele). */
export const boardsOfProject = (slug: string) => all<{ id: number }>(`
  select id from boards where project_slug = ?
  union select distinct x.board_id from task_boards x join tasks t on t.id = x.task_id where t.project_slug = ?`, slug, slug).map(r => r.id);
