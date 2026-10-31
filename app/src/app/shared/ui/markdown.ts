import { Pipe, PipeTransform } from '@angular/core';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ESC[c]);

/** Inline: `código`, **negrito**, *itálico*, [link](https://…). Texto já escapado. */
function inline(s: string): string {
  const codes: string[] = [];
  let out = esc(s).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

/**
 * Markdown suficiente para respostas de agente: títulos, listas (com e sem número), citações, blocos de código,
 * separadores e parágrafos. Escapa todo HTML; o resultado ainda passa pelo sanitizer do Angular via [innerHTML].
 */
export function markdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      html.push(`<pre><code${fence[1] ? ` data-lang="${esc(fence[1])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) { html.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '');
        // continuação indentada do mesmo item
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i + 1])) item += ' ' + lines[++i].trim();
        items.push(`<li>${inline(item)}</li>`);
        i++;
      }
      html.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++]);
    html.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return html.join('');
}

@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(text: string): string { return markdown(text ?? ''); }
}
