import { Pipe, PipeTransform } from '@angular/core';

import { linkRefs, linkUrls } from './markdown';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Markdown mínimo para texto de agente: `código` e **negrito**. Escapa todo HTML antes;
 * o resultado ainda passa pelo sanitizer do Angular via [innerHTML].
 */
export function mdLite(text: string): string {
  return text
    .replace(/[&<>"']/g, c => ESC[c])
    .replace(/`([^`\n]+)`/g, '<code class="rounded bg-night px-1 py-px font-mono text-[0.88em] text-frost">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-text">$1</strong>');
}

/** com links: #67, caminhos e URLs */
const rich = (text: string) => linkRefs(linkUrls(mdLite(text)));

@Pipe({ name: 'mdLite' })
export class MdLitePipe implements PipeTransform {
  transform(text: string): string { return rich(text); }
}
