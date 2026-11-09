/**
 * Imagens nos chats (print colado, arquivo arrastado). A tela salva o arquivo na pasta de anexos e põe um marcador
 * [[img:caminho]] no texto da mensagem; aqui o marcador vira bloco de imagem para o Claude (ele vê a imagem, sem
 * precisar de ferramenta). Só vale caminho dentro da pasta de anexos: um texto vindo de fora (WhatsApp, por exemplo)
 * não consegue fazer a Central ler outro arquivo do PC.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

export const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MARK = /\[\[img:([^\]\n]+)\]\]/g;

/** o caminho está dentro da pasta e é uma imagem que aceitamos */
export function inside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(path));
  return !!rel && !rel.startsWith('..') && !/^[a-z]:/i.test(rel) && !!MIME[extname(path).toLowerCase()];
}

/** separa o texto dos marcadores; os que apontam para fora da pasta somem (nem vão para o Claude) */
export function splitImages(text: string, dir: string): { text: string; images: string[] } {
  const images = [...text.matchAll(MARK)].map(m => m[1].trim()).filter(p => inside(dir, p));
  return { text: text.replace(MARK, '').replace(/\n{3,}/g, '\n\n').trim(), images };
}

/** conteúdo da mensagem para o Claude: texto puro, ou imagens + texto */
export function userContent(text: string, dir: string): string | unknown[] {
  const s = splitImages(text, dir);
  if (!s.images.length) return s.text;
  return [
    ...s.images.map(p => ({ type: 'image', source: { type: 'base64', media_type: MIME[extname(p).toLowerCase()], data: readFileSync(p).toString('base64') } })),
    { type: 'text', text: s.text || 'Veja a imagem.' },
  ];
}

export function saveImage(dir: string, bytes: Uint8Array, ext: string): string {
  const e = `.${ext.replace(/^\./, '').toLowerCase()}`;
  if (!MIME[e]) throw new Error('Só imagens PNG, JPG, GIF ou WebP.');
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Imagem grande demais (máximo 20 MB).');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${e}`);
  writeFileSync(file, Buffer.from(bytes));
  return file;
}

export function imageDataUrl(dir: string, path: string): string {
  if (!inside(dir, path)) throw new Error('Imagem fora da pasta de anexos.');
  return `data:${MIME[extname(path).toLowerCase()]};base64,${readFileSync(path).toString('base64')}`;
}
