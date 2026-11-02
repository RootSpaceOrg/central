/** Sessões abertas dentro de um projeto (abas): conversas com o Claude e terminais. Ficam salvas entre aberturas do app. */
import type { SessionDto, SessionKind } from '../src/app/shared/contract';
import { all, get, run } from './db';

const TITLES: Record<SessionKind, string> = { chat: 'Claude', claude: 'Claude Code', shell: 'PowerShell', cmd: 'CMD', bash: 'Git Bash' };

export const listSessions = (slug: string | null) => all<SessionDto>('select * from sessions where (? is null or project_slug = ?) order by id', slug, slug);

export function createSession(slug: string, kind: SessionKind, chatId: number | null): SessionDto {
  if (!TITLES[kind]) throw new Error('Tipo de sessão inválido.');
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error('Projeto não encontrado.');
  const chat = chatId ? get<{ title: string }>('select title from chats where id = ?', chatId) : null;
  const same = all('select 1 from sessions where project_slug = ? and kind = ?', slug, kind).length;
  const title = chat?.title ?? (same ? `${TITLES[kind]} ${same + 1}` : TITLES[kind]);
  const { lastInsertRowid } = run('insert into sessions (project_slug, kind, title, chat_id) values (?,?,?,?)', slug, kind, title, chatId);
  return get<SessionDto>('select * from sessions where id = ?', Number(lastInsertRowid))!;
}

export function updateSession(id: number, patch: { title?: string; chat_id?: number }): void {
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new Error('Nome vazio.');
    run('update sessions set title = ? where id = ?', patch.title.trim().slice(0, 80), id);
  }
  // a aba ganha o título da conversa (a primeira mensagem)
  if (patch.chat_id !== undefined) run('update sessions set chat_id = ?, title = coalesce((select title from chats where id = ?), title) where id = ?', patch.chat_id, patch.chat_id, id);
}

/** Fechar a aba não apaga a conversa: ela continua no histórico do projeto. */
export const closeSession = (id: number) => { run('delete from sessions where id = ?', id); };
