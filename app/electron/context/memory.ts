/**
 * Memória do projeto: fatos curtos e duráveis que o código não mostra (decisões, convenções, armadilhas), com quem
 * registrou e de onde veio. Ficam no central.db (dado precioso) e se ligam aos nós do índice por chave de texto.
 * Fato substituído não é apagado: fica "retirado" com a data, para a história não se perder.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { FactDto, FactKind, NewFactInput } from '../../src/app/shared/contract';
import { all, get, now, run } from '../db';

export const FACT_KINDS: FactKind[] = ['decision', 'convention', 'gotcha', 'fact', 'howto'];

export function listFacts(project: string, includeRetired = true): FactDto[] {
  const rows = all<any>(`select * from facts where project_slug = ? and (? = 1 or status = 'active') order by pinned desc, id desc`, project, includeRetired ? 1 : 0);
  const links = all<{ fact_id: number; node_key: string }>(
    `select l.fact_id, l.node_key from fact_links l join facts f on f.id = l.fact_id where f.project_slug = ?`, project);
  return rows.map(r => ({ ...r, pinned: !!r.pinned, links: links.filter(l => l.fact_id === r.id).map(l => l.node_key) }));
}

export function createFact(i: NewFactInput & { source_kind?: string; source_ref?: string | null; author?: string }): FactDto {
  const text = i.text?.trim();
  if (!text) throw new Error('Escreva o fato.');
  if (text.length > 400) throw new Error('Fato longo demais: uma afirmação curta (até 400 caracteres).');
  if (!FACT_KINDS.includes(i.kind)) throw new Error('Tipo de fato inválido.');
  if (!get('select 1 from projects where slug = ?', i.project_slug)) throw new Error('Projeto não encontrado.');
  const id = Number(run(`insert into facts (project_slug, kind, text, source_kind, source_ref, author, pinned) values (?,?,?,?,?,?,?)`,
    i.project_slug, i.kind, text, i.source_kind ?? 'manual', i.source_ref ?? null, i.author ?? 'gustavo', i.pinned ? 1 : 0).lastInsertRowid);
  for (const k of new Set(i.links ?? [])) run('insert or ignore into fact_links (fact_id, node_key) values (?,?)', id, k);
  return listFacts(i.project_slug).find(f => f.id === id)!;
}

export function updateFact(id: number, patch: { text?: string; kind?: FactKind; pinned?: boolean; links?: string[] }): void {
  const f = get<{ project_slug: string }>('select project_slug from facts where id = ?', id);
  if (!f) throw new Error('Fato não encontrado.');
  if (patch.text !== undefined) {
    if (!patch.text.trim()) throw new Error('Escreva o fato.');
    run('update facts set text = ? where id = ?', patch.text.trim(), id);
  }
  if (patch.kind) { if (!FACT_KINDS.includes(patch.kind)) throw new Error('Tipo inválido.'); run('update facts set kind = ? where id = ?', patch.kind, id); }
  if (patch.pinned !== undefined) run('update facts set pinned = ? where id = ?', patch.pinned ? 1 : 0, id);
  if (patch.links) {
    run('delete from fact_links where fact_id = ?', id);
    for (const k of new Set(patch.links)) run('insert into fact_links (fact_id, node_key) values (?,?)', id, k);
  }
}

/** Marca como inválido (com motivo) e, se houver, registra o substituto com os mesmos vínculos. */
export function supersedeFact(id: number, reason: string, replacement: string | null, author = 'gustavo'): FactDto | null {
  const f = listFacts(get<{ p: string }>('select project_slug p from facts where id = ?', id)?.p ?? '').find(x => x.id === id);
  if (!f) throw new Error('Fato não encontrado.');
  let next: FactDto | null = null;
  if (replacement?.trim()) {
    next = createFact({ project_slug: f.project_slug, kind: f.kind, text: replacement, links: f.links, pinned: f.pinned, source_kind: 'supersede', source_ref: String(id), author });
  }
  run(`update facts set status = 'retired', invalidated_at = ?, superseded_by = ?, source_ref = coalesce(source_ref, '') || ? where id = ?`,
    now(), next?.id ?? null, reason ? ` | retirado: ${reason}` : '', id);
  return next;
}

export const deleteFact = (id: number) => { run('delete from facts where id = ?', id); };

/** Para os agentes: fatos ativos que batem com a busca e/ou estão ligados às chaves. */
export function recallFacts(project: string, query = '', keys: string[] = [], limit = 10): string {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  // ponytail: pontuação por palavras em comum; FTS5/embeddings se a memória passar de algumas centenas de fatos
  const scored = listFacts(project, false).map(f => ({
    f, s: (f.pinned ? 2 : 0) + words.filter(w => f.text.toLowerCase().includes(w)).length + (f.links.some(l => keys.some(k => l.includes(k) || k.includes(l))) ? 3 : 0),
  })).filter(x => x.s > 0 || (!words.length && !keys.length)).sort((a, b) => b.s - a.s).slice(0, limit);
  if (!scored.length) return 'Nenhum fato registrado que combine. Se descobrir algo durável, use memory_remember.';
  return scored.map(({ f }) => `#${f.id} [${f.kind}] ${f.text}${f.links.length ? `\n   ligado a: ${f.links.join(', ')}` : ''}\n   fonte: ${f.author}, ${f.created_at.slice(0, 10)}`).join('\n');
}

/**
 * Traz a auto memory do Claude Code (~/.claude/projects/<pasta>/memory/*.md) das pastas do projeto como fatos.
 * Uma vez por arquivo (source_ref = caminho); editar o fato aqui não reescreve o arquivo do Claude.
 */
export function importClaudeMemory(project: string): number {
  const p = get<{ folder: string }>('select folder from projects where slug = ?', project);
  if (!p) return 0;
  const root = join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) return 0;
  const folders = [p.folder, ...all<{ path: string }>('select path from repos where project_slug = ?', project).map(r => r.path)];
  const encoded = new Set(folders.map(f => f.replace(/[:\\/. ]/g, '-')));
  let added = 0;
  for (const dir of readdirSync(root)) {
    if (!encoded.has(dir)) continue;
    const mem = join(root, dir, 'memory');
    if (!existsSync(mem)) continue;
    for (const file of readdirSync(mem).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')) {
      const path = join(mem, file);
      if (get('select 1 from facts where source_ref = ?', path)) continue;
      const raw = readFileSync(path, 'utf8');
      const body = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
      const type = /type:\s*(\w+)/.exec(raw)?.[1] ?? 'fact';
      const desc = /description:\s*(.+)/.exec(raw)?.[1]?.trim();
      const text = (desc || body.split('\n').find(l => l.trim()) || '').replace(/^[#\-*\s]+/, '').slice(0, 380);
      if (!text) continue;
      const kind: FactKind = type === 'feedback' ? 'convention' : type === 'project' ? 'decision' : 'fact';
      createFact({ project_slug: project, kind, text, source_kind: 'claude_auto_memory', source_ref: path, author: 'claude' });
      added++;
    }
  }
  return added;
}
