/**
 * Dados vindos de outro computador (ex.: Windows → Mac): os caminhos dos projetos apontam para o disco de lá. O que não
 * existe aqui e está dentro de uma pasta "Development" vai para a mesma posição dentro da pasta de projetos daqui.
 * C:\Users\Gustavo\Development\mktPlatform\api → /Users/gustavo/Development/mktPlatform/api
 */
import { join } from 'node:path';

export function remapPath(p: string | null, devRoot: string, exists: (p: string) => boolean): string | null {
  if (!p || exists(p)) return p;
  const m = /(?:^|[\\/])Development[\\/](.+)$/i.exec(p);
  if (!m) return p;
  return join(devRoot, ...m[1].split(/[\\/]+/).filter(Boolean));
}
