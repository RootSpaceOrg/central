/** Texto do WhatsApp: puro (sem Electron), testado em scripts/whatsapp.check.mjs. */

export const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

/** Markdown da Central → texto do WhatsApp (*negrito*, • listas, sem cabeçalhos nem código). */
export function toWhatsApp(md: string): string {
  return md
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

/**
 * Resposta → mensagens: cada parágrafo (separado por linha em branco) que o agente escreve vira uma mensagem. Quem
 * decide como quebrar é o agente (pelo prompt dele); aqui só há um teto contra exagero: o que passar vai na última.
 */
export function splitReply(text: string, max = 8): string[] {
  const out = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return out.length > max ? [...out.slice(0, max - 1), out.slice(max - 1).join('\n\n')] : out;
}

/** Até max acionamentos por chave na última hora (max 0 = sem limite). O que passa fica de fora até a janela andar. */
export function hitLimiter(windowMs = 3_600_000) {
  const hits = new Map<string, number[]>();
  return (key: string, max: number, now = Date.now()): boolean => {
    if (!max) return true;
    const list = (hits.get(key) ?? []).filter(t => now - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    hits.set(key, [...list, now]);
    return true;
  };
}
