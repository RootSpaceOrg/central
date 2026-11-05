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
