/**
 * Aparência do boneco 3D de um agente (sem three.js: o editor e os modelos usam sem carregar o 3D).
 * Fica no agente como JSON; vazio = boneco padrão.
 */

export type HairStyle = 'curto' | 'longo' | 'rabo' | 'coque' | 'cacheado' | 'moicano' | 'careca';
export type Accessory = 'nenhum' | 'oculos' | 'fone' | 'gorro' | 'bone' | 'barba';

export interface AvatarLook {
  hair: HairStyle;
  acc: Accessory;
  /** índice em SKINS; -1 = automático (pela chave) */
  skin: number;
  /** cor da roupa; '' = a cor do projeto */
  outfit: string;
}

export const LOOK_DEFAULT: AvatarLook = { hair: 'curto', acc: 'nenhum', skin: -1, outfit: '' };

export const SKINS = ['#f1c9a5', '#e0ac85', '#c68863', '#8d5a3b', '#f5d6bd'];

export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: 'curto', label: 'Curto' }, { id: 'longo', label: 'Longo' }, { id: 'rabo', label: 'Rabo de cavalo' }, { id: 'coque', label: 'Coque' },
  { id: 'cacheado', label: 'Cacheado' }, { id: 'moicano', label: 'Moicano' }, { id: 'careca', label: 'Careca' },
];
export const ACCESSORIES: { id: Accessory; label: string }[] = [
  { id: 'nenhum', label: 'Nada' }, { id: 'oculos', label: 'Óculos' }, { id: 'fone', label: 'Fone' }, { id: 'gorro', label: 'Gorro' },
  { id: 'bone', label: 'Boné' }, { id: 'barba', label: 'Barba' },
];

/** JSON do banco → look válido (campo estranho volta ao padrão). */
export function parseLook(raw: string | null | undefined): AvatarLook {
  if (!raw) return LOOK_DEFAULT;
  try {
    const v = JSON.parse(raw) as Partial<AvatarLook>;
    return {
      hair: HAIR_STYLES.some(h => h.id === v.hair) ? v.hair! : LOOK_DEFAULT.hair,
      acc: ACCESSORIES.some(a => a.id === v.acc) ? v.acc! : LOOK_DEFAULT.acc,
      skin: Number.isInteger(v.skin) && v.skin! >= -1 && v.skin! < SKINS.length ? v.skin! : -1,
      outfit: typeof v.outfit === 'string' && /^(#[0-9a-fA-F]{6})?$/.test(v.outfit) ? v.outfit : '',
    };
  } catch {
    return LOOK_DEFAULT;
  }
}
