/**
 * Uso do plano do Claude (sessão, semana, limites por modelo): o mesmo número do /usage do Claude Code.
 * Lê o token do login local do Claude Code e só consulta. Nunca renova o token: renovar giraria o
 * refresh token e derrubaria a sessão do próprio Claude Code.
 * O endpoint limita consultas (429): no máximo uma forçada por minuto, pausa de 5 min depois de um 429,
 * e o último número bom fica salvo para aparecer mesmo quando a consulta falha.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { UsageDto, UsageLimitDto } from '../src/app/shared/contract';
import { getSetting, setSetting } from './backlog';

const CREDENTIALS = join(process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'), '.credentials.json');
const TTL = 60_000;
const MIN_FORCE = 60_000;
const BACKOFF = 5 * 60_000;
let cache: UsageDto | null = null;
let lastFetch = 0;
let blockedUntil = 0;

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

/** último uso bom conhecido (memória ou banco) */
function lastGood(): UsageLimitDto[] {
  if (cache?.limits.length) return cache.limits;
  try { return JSON.parse(getSetting('usage:last') ?? '[]'); } catch { return []; }
}

export async function getUsage(force: boolean): Promise<UsageDto> {
  const nowMs = Date.now();
  const fresh = cache && nowMs - lastFetch < (force ? MIN_FORCE : TTL);
  if (fresh || nowMs < blockedUntil) return cache ?? { limits: lastGood(), fetched_at: new Date().toISOString(), error: null };
  lastFetch = nowMs;
  const fetched_at = new Date().toISOString();
  const fail = (error: string): UsageDto => (cache = { limits: lastGood(), fetched_at, error });

  let token: string;
  try {
    const oauth = JSON.parse(readFileSync(CREDENTIALS, 'utf8')).claudeAiOauth;
    if (!oauth?.accessToken) throw new Error();
    if (oauth.expiresAt && oauth.expiresAt < nowMs) return fail('Login do Claude Code expirou. Abra o Claude Code para renovar.');
    token = oauth.accessToken;
  } catch {
    return fail('Faça login no Claude Code para ver o uso.');
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'central' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) { blockedUntil = nowMs + BACKOFF; return fail('Muitas consultas de uso; atualiza de novo em alguns minutos.'); }
    if (res.status === 401) return fail('Login do Claude Code expirou. Abra o Claude Code para renovar.');
    if (!res.ok) return fail(`Uso indisponível agora (HTTP ${res.status}).`);
    const body = await res.json() as { limits?: RawLimit[] };
    const limits: UsageLimitDto[] = (body.limits ?? []).map(l => ({
      kind: l.kind, label: label(l), percent: Math.round(l.percent), severity: l.severity, resets_at: l.resets_at,
    }));
    if (limits.length) setSetting('usage:last', JSON.stringify(limits));
    return (cache = { limits, fetched_at, error: null });
  } catch {
    return fail('Sem conexão para ler o uso do Claude.');
  }
}
