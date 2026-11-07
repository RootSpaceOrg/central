import { Pipe, PipeTransform } from '@angular/core';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ESC[c]);

/** Inline: `código`, **negrito**, *itálico*, [link](https://…). Texto já escapado. */
function inline(s: string): string {
  const codes: string[] = [];
  let out = esc(s).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

/** Linha separadora de tabela GFM: |---|:--:|--:| (os ":" dizem o alinhamento). */
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const isTableStart = (lines: string[], i: number) => lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]);

/** Células de uma linha de tabela: separa por "|" fora de `código` e respeita "\|". */
function cells(row: string): string[] {
  const out: string[] = [];
  let cur = '', code = false;
  const s = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function table(lines: string[], start: number): { html: string; end: number } {
  const head = cells(lines[start]);
  // classe e não style: o sanitizer do Angular remove atributos style do [innerHTML]
  const align = cells(lines[start + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'ac' : c.endsWith(':') ? 'ar' : ''));
  const td = (tag: string, c: string, k: number) => `<${tag}${align[k] ? ` class="${align[k]}"` : ''}>${inline(c)}</${tag}>`;
  const rows: string[] = [];
  let i = start + 2;
  for (; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) {
    const r = cells(lines[i]);
    rows.push(`<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`);
  }
  return {
    html: `<div class="md-table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
    end: i,
  };
}

/**
 * Markdown suficiente para respostas de agente: títulos, listas (com e sem número), citações, blocos de código,
 * tabelas (GFM), separadores e parágrafos. Escapa todo HTML; o resultado ainda passa pelo sanitizer do Angular via [innerHTML].
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
    if (isTableStart(lines, i)) {
      const t = table(lines, i);
      html.push(t.html);
      i = t.end;
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
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++]);
    html.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return linkRefs(html.join(''));
}

@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(text: string): string { return markdown(text ?? ''); }
}

/**
 * "#67" vira link (o App abre a tarefa; "execução #34" abre a execução). PR, issue, ideia e decisão ficam como texto.
 * Só no texto: nada dentro de tags, links e código.
 */
export function linkRefs(html: string): string {
  let skip = 0;
  return html.split(/(<[^>]+>)/).map(part => {
    if (part.startsWith('<')) {
      if (/^<(a|code|pre)\b/i.test(part)) skip++;
      else if (/^<\/(a|code|pre)>/i.test(part)) skip = Math.max(0, skip - 1);
      return part;
    }
    if (skip) return part;
    return part.replace(/(^|[^&\w/])#(\d{1,6})\b/g, (m, pre: string, n: string, at: number, all: string) => {
      const before = all.slice(Math.max(0, at - 24), at + pre.length).toLowerCase();
      if (/(pr|pull request|issue|ideia|decis[aã]o|guia|release|vers[aã]o|issue)\s*$/.test(before)) return m;
      const kind = /(execu[cç][aã]o|execu[cç][oõ]es|run)\s*$/.test(before) ? 'execucao' : 'tarefa';
      return `${pre}<a href="#${kind}-${n}" class="ref-link" title="Abrir ${kind === 'tarefa' ? 'a tarefa' : 'a execução'} #${n}">#${n}</a>`;
    });
  }).join('');
}

/** texto puro com as referências (#67) clicáveis: use com [innerHTML] */
@Pipe({ name: 'refs' })
export class RefsPipe implements PipeTransform {
  transform(text: string | null | undefined): string { return linkRefs(esc(text ?? '')); }
}
