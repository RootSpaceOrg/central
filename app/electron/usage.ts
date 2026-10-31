/**
 * Uso do plano do Claude (sessão, semana, limites por modelo): o mesmo número do /usage do Claude Code.
 * Lê o token do login local do Claude Code e só consulta. Nunca renova o token: renovar giraria o
 * refresh token e derrubaria a sessão do próprio Claude Code.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { UsageDto, UsageLimitDto } from '../src/app/shared/contract';

const CREDENTIALS = join(process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'), '.credentials.json');
const TTL = 60_000;
let cache: UsageDto | null = null;

interface RawLimit {
  kind: string;
  percent: number;
  severity: string;
  resets_at: string | null;
  scope: { model?: { display_name?: string | null } | null } | null;
}

export function label(l: RawLimit): string {
  if (l.kind === 'session') return 'Sessão';
  if (l.kind === 'weekly_all') return 'Semana';
  return l.scope?.model?.display_name ?? l.kind.replace(/_/g, ' ');
}

export async function getUsage(force: boolean): Promise<UsageDto> {
  if (!force && cache && Date.now() - Date.parse(cache.fetched_at) < TTL) return cache;
  const fetched_at = new Date().toISOString();
  let token: string;
  try {
    const oauth = JSON.parse(readFileSync(CREDENTIALS, 'utf8')).claudeAiOauth;
    if (!oauth?.accessToken) throw new Error();
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
      return (cache = { limits: cache?.limits ?? [], fetched_at, error: 'Login do Claude Code expirou. Abra o Claude Code para renovar.' });
    }
    token = oauth.accessToken;
  } catch {
    return (cache = { limits: [], fetched_at, error: 'Faça login no Claude Code para ver o uso.' });
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'central' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Login do Claude Code expirou. Abra o Claude Code para renovar.' : `HTTP ${res.status}`);
    const body = await res.json() as { limits?: RawLimit[] };
    const limits: UsageLimitDto[] = (body.limits ?? []).map(l => ({
      kind: l.kind, label: label(l), percent: Math.round(l.percent), severity: l.severity, resets_at: l.resets_at,
    }));
    return (cache = { limits, fetched_at, error: null });
  } catch (e) {
    // offline ou fora do ar: mantém o último número conhecido
    return (cache = { limits: cache?.limits ?? [], fetched_at, error: (e as Error).message || 'Sem conexão.' });
  }
}
