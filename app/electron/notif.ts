/**
 * O que gera notificação, e como (puro: o teste importa sem o Electron). Cada tipo de aviso tem a sua regra; "não perturbe"
 * cala tudo num horário; o som pode ser o do sistema, nenhum ou um dos sons da Central (tocado pela tela).
 */
export type NotifLevel = 'all' | 'failed' | 'none';
export type NotifKind = 'run' | 'board' | 'routine' | 'idle' | 'waiting' | 'ci' | 'system';
export type NotifSound = 'system' | 'none' | 'chime' | 'drop' | 'pop' | 'bell';

export interface NotifPrefs {
  /** execução de agente (tarefa, start_agent, conversa em segundo plano) terminou */
  agents: NotifLevel;
  /** etapa de um quadro terminou (cada coluna de cada cartão) */
  boards: NotifLevel;
  /** rotina terminou */
  routines: NotifLevel;
  /** tudo terminou: nada rodando nem esperando na fila */
  idle: boolean;
  /** agente parado esperando você (login, acesso…) */
  waiting: boolean;
  /** GitHub Actions quebrado */
  ci: boolean;
  sound: NotifSound;
  /** não perturbe: "22-07" (das 22h às 7h); vazio = desligado */
  quiet: string;
}

export const NOTIF_DEFAULTS: NotifPrefs = { agents: 'all', boards: 'failed', routines: 'failed', idle: true, waiting: true, ci: true, sound: 'system', quiet: '' };

/** dentro do horário de não perturbe? ("22-07" atravessa a meia-noite) */
export function inQuiet(quiet: string, now: Date): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(quiet.trim());
  if (!m) return false;
  const [a, b] = [Number(m[1]) % 24, Number(m[2]) % 24];
  const h = now.getHours();
  return a === b ? false : a < b ? h >= a && h < b : h >= a || h < b;
}

/** avisa? ok = terminou bem (para os tipos de execução) */
export function shouldNotify(p: NotifPrefs, kind: NotifKind, ok: boolean, now: Date): boolean {
  if (kind !== 'system' && inQuiet(p.quiet, now)) return false;
  const level = (l: NotifLevel) => l === 'all' || (l === 'failed' && !ok);
  switch (kind) {
    case 'run': return level(p.agents);
    case 'board': return level(p.boards);
    case 'routine': return level(p.routines);
    case 'idle': return p.idle;
    case 'waiting': return p.waiting;
    case 'ci': return p.ci;
    default: return true;
  }
}

export function parseNotif(raw: string | null): NotifPrefs {
  try { return { ...NOTIF_DEFAULTS, ...(raw ? JSON.parse(raw) : {}) }; } catch { return { ...NOTIF_DEFAULTS }; }
}
