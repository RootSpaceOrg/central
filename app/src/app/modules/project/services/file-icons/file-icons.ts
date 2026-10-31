import { Injectable, signal } from '@angular/core';

/** Manifesto gerado por scripts/file-icons.mjs a partir do Material Icon Theme (PKief). */
export interface IconManifest {
  file: string;
  folder: string;
  folderExpanded: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
}

/**
 * Mesma ordem do VS Code: nome exato → extensão mais longa primeiro ("spec.ts" antes de "ts") → padrão.
 * Pastas: nome exato (aberta/fechada) → padrão.
 */
export function resolveIcon(m: IconManifest, name: string, dir: boolean, open = false): string {
  const n = name.toLowerCase();
  if (dir) return (open ? m.folderNamesExpanded[n] : m.folderNames[n]) ?? (open ? m.folderExpanded : m.folder);
  if (m.fileNames[n]) return m.fileNames[n];
  const parts = n.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    if (m.fileExtensions[ext]) return m.fileExtensions[ext];
  }
  return m.file;
}

/** Carrega o manifesto uma vez; até lá, devolve os ícones genéricos. */
@Injectable({ providedIn: 'root' })
export class FileIconsService {
  private readonly manifest = signal<IconManifest | null>(null);

  constructor() {
    fetch('file-icons/manifest.json').then(r => r.json()).then(m => this.manifest.set(m)).catch(() => {});
  }

  /** caminho do SVG para <img> */
  src(name: string, dir: boolean, open = false): string {
    const m = this.manifest();
    const icon = m ? resolveIcon(m, name, dir, open) : dir ? (open ? 'folder-open' : 'folder') : 'file';
    return `file-icons/${icon}.svg`;
  }
}
