/**
 * Memória dos agentes (além dos fatos de projeto): o que vale lembrar entre conversas.
 * - do agente (agent_id): o jeito dele trabalhar com o Gustavo, o que aprendeu no papel dele;
 * - compartilhada (agent_id null): sobre o Gustavo, clientes, decisões que cruzam projetos. Todos os agentes recebem.
 * Entra sozinha no prompt (fixadas primeiro, depois as mais recentes); esquecer não apaga, retira com o motivo.
 */
import type { MemoryDto, MemoryKind, NewMemoryInput } from '../src/app/shared/contract';
import { all, get, now, run } from './db';

export const MEMORY_KINDS: MemoryKind[] = ['preferencia', 'fato', 'decisao', 'pessoa', 'como_fazer'];
const LABEL: Record<MemoryKind, string> = { preferencia: 'preferência', fato: 'fato', decisao: 'decisão', pessoa: 'pessoa', como_fazer: 'como fazer' };
/** quantas entram no prompt de cada escopo */
const IN_PROMPT = 25;

export const listMemories = (agentId: number | 'shared' | 'all', includeRetired = false) => all<any>(
  `select * from memories where (? = 'all' or (? = 'shared' and agent_id is null) or agent_id = ?) and (? = 1 or status = 'active')
   order by pinned desc, id desc`, String(agentId), String(agentId), typeof agentId === 'number' ? agentId : -1, includeRetired ? 1 : 0,
).map(r => ({ ...r, pinned: !!r.pinned })) as MemoryDto[];

export function createMemory(i: NewMemoryInput & { author?: string; source?: string | null }): MemoryDto {
  const text = i.text?.trim();
  if (!text) throw new Error('Escreva o que lembrar.');
  if (text.length > 400) throw new Error('Curto demais é melhor: uma afirmação de até 400 caracteres.');
  if (!MEMORY_KINDS.includes(i.kind)) throw new Error('Tipo de memória inválido.');
  if (i.agent_id && !get('select 1 from agents where id = ?', i.agent_id)) throw new Error('Agente não encontrado.');
  // a mesma coisa duas vezes não: devolve a que já existe
  const dup = get<{ id: number }>(`select id from memories where status = 'active' and coalesce(agent_id, 0) = ? and lower(text) = lower(?)`, i.agent_id ?? 0, text);
  const id = dup?.id ?? Number(run('insert into memories (agent_id, kind, text, author, source, pinned) values (?,?,?,?,?,?)',
    i.agent_id ?? null, i.kind, text, i.author ?? 'gustavo', i.source ?? null, i.pinned ? 1 : 0).lastInsertRowid);
  return listMemories('all').find(m => m.id === id)!;
}

export function updateMemory(id: number, patch: { text?: string; kind?: MemoryKind; pinned?: boolean; agent_id?: number | null }): void {
  if (!get('select 1 from memories where id = ?', id)) throw new Error('Memória não encontrada.');
  if (patch.text !== undefined) {
    if (!patch.text.trim()) throw new Error('Escreva o que lembrar.');
    run('update memories set text = ? where id = ?', patch.text.trim().slice(0, 400), id);
  }
  if (patch.kind) { if (!MEMORY_KINDS.includes(patch.kind)) throw new Error('Tipo inválido.'); run('update memories set kind = ? where id = ?', patch.kind, id); }
  if (patch.pinned !== undefined) run('update memories set pinned = ? where id = ?', patch.pinned ? 1 : 0, id);
  if (patch.agent_id !== undefined) run('update memories set agent_id = ? where id = ?', patch.agent_id, id);
}

/** Esquecer: sai do prompt, mas fica registrado com o motivo. */
export function forgetMemory(id: number, reason: string, author = 'gustavo'): void {
  if (!get('select 1 from memories where id = ?', id)) throw new Error('Memória não encontrada.');
  run(`update memories set status = 'retired', retired_at = ?, retired_reason = ? where id = ?`, now(), `${reason.trim() || 'sem motivo'} (${author})`, id);
}

export const deleteMemory = (id: number) => { run('delete from memories where id = ?', id); };

const line = (m: MemoryDto) => `- [#${m.id} ${LABEL[m.kind]}] ${m.text}`;

/** Para o prompt: o que é de todos + o que é deste agente. */
export function memoryBlock(agentId: number | null): string {
  const shared = listMemories('shared').slice(0, IN_PROMPT);
  const own = agentId ? listMemories(agentId).slice(0, IN_PROMPT) : [];
  if (!shared.length && !own.length) {
    return '## Memória\nAinda vazia. Quando aprender algo durável (preferência do Gustavo, decisão, pessoa, jeito de fazer), guarde com remember.';
  }
  return [
    '## Memória (o que você já sabe; atualize com remember/forget)',
    shared.length ? `De todos os agentes:\n${shared.map(line).join('\n')}` : '',
    own.length ? `Sua:\n${own.map(line).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

/** Para recall: o que combina com a busca (palavras em comum), da memória do agente e da compartilhada. */
export function recallMemories(agentId: number | null, query: string, limit = 15): string {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const pool = [...listMemories('shared'), ...(agentId ? listMemories(agentId) : [])];
  // ponytail: palavras em comum; FTS5 quando passar de algumas centenas
  const hits = pool.map(m => ({ m, s: (m.pinned ? 1 : 0) + words.filter(w => m.text.toLowerCase().includes(w)).length }))
    .filter(x => !words.length || x.s > (x.m.pinned ? 1 : 0)).sort((a, b) => b.s - a.s).slice(0, limit);
  if (!hits.length) return 'Nada guardado que combine.';
  return hits.map(({ m }) => `${line(m)} (${m.agent_id ? 'sua' : 'de todos'}, ${m.author}, ${m.created_at.slice(0, 10)})`).join('\n');
}

/** Quem está chamando o MCP (conversa ou execução) → agente. */
export function callerAgent(caller: { kind: 'chat' | 'run'; id: number } | null): number | null {
  if (!caller) return null;
  const table = caller.kind === 'chat' ? 'chats' : 'runs';
  return get<{ a: number | null }>(`select agent_id a from ${table} where id = ?`, caller.id)?.a ?? null;
}
