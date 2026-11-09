/**
 * Importa sessões existentes do Claude Code (as de ~/.claude/projects, inclusive as abertas pelo Orca ou no terminal)
 * para uma conversa de projeto da Central. O histórico vira mensagens na tela; a conversa continua com --resume
 * na pasta original e, a partir daí, recebe o contexto da Central (backlog, ideias, decisões) a cada mensagem.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ClaudeSessionDto, SessionDto } from '../src/app/shared/contract';
import { centralAgent } from './agentdefs';
import { describe, INTERNAL } from './central-agent';
import { get, run } from './db';
import { createSession } from './sessions';

const ROOT = join(homedir(), '.claude', 'projects');
const HEAD = 512 * 1024;

const lines = (text: string) => text.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });

/** Texto que o Gustavo escreveu (ignora resultados de ferramenta, comandos internos e lembretes do sistema). */
function userText(m: any): string {
  const c = m.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '';
  return /^\s*<(command-|local-command|system-reminder)/.test(text) ? '' : text.trim();
}

function head(file: string): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(HEAD, statSync(file).size));
    readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}

function summarize(file: string, id: string, updated: Date): ClaudeSessionDto | null {
  const entries = lines(head(file));
  const cwd = entries.find(e => e.cwd)?.cwd as string | undefined;
  if (!cwd) return null;
  const last = (type: string) => [...entries].reverse().find(e => e.type === type);
  const title = last('custom-title')?.customTitle ?? last('ai-title')?.aiTitle
    ?? entries.map(e => (e.type === 'user' && !e.isSidechain ? userText(e) : '')).find(Boolean)?.replace(/\s+/g, ' ').slice(0, 90) ?? '(sem título)';
  const imported = get<{ id: number }>('select id from chats where session_id = ?', id);
  return { session_id: id, cwd, title, updated_at: updated.toISOString(), size_kb: Math.round(statSync(file).size / 1024), imported_chat_id: imported?.id ?? null };
}

/** Sessões do Claude Code, mais recentes primeiro. As da Central (worktrees e pastas de agentes) ficam de fora. */
export function listClaudeSessions(): ClaudeSessionDto[] {
  if (!existsSync(ROOT)) return [];
  const files = readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && !/--central-(worktrees|agents)/.test(d.name))
    .flatMap(d => readdirSync(join(ROOT, d.name)).filter(f => f.endsWith('.jsonl')).map(f => join(ROOT, d.name, f)))
    .map(f => ({ f, at: statSync(f).mtime }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 300);
  return files.flatMap(({ f, at }) => summarize(f, f.split(/[\\/]/).pop()!.replace(/\.jsonl$/, ''), at) ?? []);
}

function fileOf(sessionId: string): string | null {
  if (!/^[\w-]+$/.test(sessionId) || !existsSync(ROOT)) return null;
  for (const d of readdirSync(ROOT)) {
    const f = join(ROOT, d, `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

export function importClaudeSession(sessionId: string, slug: string): SessionDto {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error('Projeto não encontrado.');
  const existing = get<{ id: number }>('select id from chats where session_id = ?', sessionId);
  if (existing) {
    run('update chats set project_slug = ? where id = ?', slug, existing.id);
    return get<SessionDto>('select * from sessions where chat_id = ?', existing.id) ?? createSession(slug, 'chat', existing.id);
  }
  const file = fileOf(sessionId);
  if (!file) throw new Error('Sessão do Claude Code não encontrada.');
  const info = summarize(file, sessionId, statSync(file).mtime)!;
  if (!existsSync(info.cwd)) throw new Error(`A pasta original da sessão (${info.cwd}) não existe mais: o Claude não consegue retomar.`);

  const chatId = Number(run('insert into chats (agent_id, title, session_id, cwd, project_slug) values (?,?,?,?,?)',
    centralAgent().id, info.title, sessionId, info.cwd, slug).lastInsertRowid);
  const add = (role: string, text: string, at: string) => run('insert into chat_messages (chat_id, role, text, at) values (?,?,?,?)', chatId, role, text, at);
  for (const e of lines(readFileSync(file, 'utf8'))) {
    if (e.isSidechain || !e.timestamp) continue;
    if (e.type === 'user') {
      const t = userText(e);
      if (t) add('user', t, e.timestamp);
    } else if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b.type === 'text' && b.text?.trim()) add('assistant', b.text.trim(), e.timestamp);
        if (b.type === 'tool_use' && !INTERNAL.has(b.name)) add('tool', describe(b.name, b.input), e.timestamp);
      }
    }
  }
  const project = get<{ name: string }>('select name from projects where slug = ?', slug)!;
  add('tool', `Sessão importada do Claude Code (pasta ${info.cwd}) para o projeto ${project.name}. A partir daqui ela conhece a Central: backlog, ideias, decisões e agentes.`,
    new Date().toISOString());
  run('update chats set updated_at = ? where id = ?', new Date().toISOString(), chatId);
  return createSession(slug, 'chat', chatId);
}
