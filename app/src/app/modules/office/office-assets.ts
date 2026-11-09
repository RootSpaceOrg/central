import { AnimationAction, AnimationClip, AnimationMixer, Box3, LoopOnce, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Modelos 3D do Escritório: personagens e móveis da Kenney (CC0, public/office/LICENSE-kenney.txt).
 * Carrega uma vez; cada pessoa/móvel é uma cópia (personagem com esqueleto e animações próprias).
 */
export const CHARACTERS = [
  'female-a', 'male-a', 'female-b', 'male-b', 'female-c', 'male-c', 'female-d', 'male-d', 'female-e', 'male-e', 'female-f', 'male-f', 'male-g', 'worker',
] as const;

const FURNITURE = [
  'desk', 'deskCorner', 'chairDesk', 'computerScreen', 'computerKeyboard', 'computerMouse', 'laptop', 'kitchenCoffeeMachine', 'kitchenFridgeLarge',
  'kitchenBar', 'kitchenCabinet', 'kitchenMicrowave', 'loungeSofa', 'loungeSofaCorner', 'loungeChair', 'loungeDesignChair', 'tableCoffee', 'tableRound',
  'table', 'chairModernCushion', 'stoolBar', 'pottedPlant', 'plantSmall1', 'plantSmall2', 'plantSmall3', 'bookcaseOpen', 'bookcaseClosedWide', 'books',
  'rugRectangle', 'rugRound', 'lampRoundFloor', 'trashcan', 'speaker', 'televisionModern', 'cardboardBoxClosed', 'sideTable',
] as const;
export type Prop = (typeof FURNITURE)[number];

/** altura de uma pessoa em pé (ladrilhos) */
export const PERSON_H = 1.3;

export interface Character {
  root: Object3D;
  mixer: AnimationMixer;
  /** troca a animação com transição; once = toca uma vez e volta para a anterior */
  play(name: string, fade?: number, once?: boolean): void;
  readonly current: string;
}

export interface Kit {
  character(i: number): Character;
  prop(name: Prop): Object3D;
}

let loading: Promise<Kit> | null = null;

export function loadKit(): Promise<Kit> {
  return (loading ??= load());
}

async function load(): Promise<Kit> {
  const loader = new GLTFLoader();
  const get = (url: string) => loader.loadAsync(url);
  const [chars, props] = await Promise.all([
    Promise.all(CHARACTERS.map(c => get(`office/characters/character-${c}.glb`))),
    Promise.all(FURNITURE.map(f => get(`office/furniture/${f}.glb`))),
  ]);
  const shadows = (o: Object3D) => o.traverse(x => { if (x instanceof Mesh) { x.castShadow = true; x.receiveShadow = true; } });
  const propMap = new Map<string, Object3D>(FURNITURE.map((f, i) => { shadows(props[i].scene); return [f, props[i].scene]; }));
  // escala única dos personagens (todos têm a mesma altura de modelo)
  const h = new Box3().setFromObject(chars[0].scene).getSize(new Vector3()).y || 1;
  const scale = PERSON_H / h;

  return {
    character(i: number): Character {
      const src = chars[((i % chars.length) + chars.length) % chars.length];
      const root = cloneSkinned(src.scene);
      shadows(root);
      root.scale.setScalar(scale);
      const holder = new Object3D();
      holder.add(root);
      const mixer = new AnimationMixer(root);
      const clips = new Map(src.animations.map((c: AnimationClip) => [c.name, c]));
      let current = '';
      let action: AnimationAction | null = null;
      const c: Character = {
        root: holder, mixer,
        get current() { return current; },
        play(name, fade = 0.25, once = false) {
          if (name === current && !once) return;
          const clip = clips.get(name);
          if (!clip) return;
          const next = mixer.clipAction(clip);
          next.reset();
          if (once) { next.setLoop(LoopOnce, 1); next.clampWhenFinished = true; }
          next.fadeIn(fade).play();
          action?.fadeOut(fade);
          const prev = current;
          action = next;
          current = name;
          if (once) {
            const back = () => { mixer.removeEventListener('finished', back); if (current === name) c.play(prev || 'idle', 0.3); };
            mixer.addEventListener('finished', back);
          }
        },
      };
      c.play('idle', 0);
      return c;
    },
    prop(name: Prop): Object3D {
      const o = propMap.get(name)!.clone(true);
      return o;
    },
  };
}

/**
 * Encaixa um móvel nas medidas (largura x, altura y, profundidade z; 0 = proporcional à altura), base no chão,
 * centralizado; tint troca a cor de materiais pelo nome (ex.: { metal: '#2b2f38' }).
 */
export function fitBox(o: Object3D, w: number, h: number, d: number, tint: Record<string, string> = {}): Object3D {
  const s = new Box3().setFromObject(o).getSize(new Vector3());
  const k = h / (s.y || 1);
  o.scale.set(w ? w / (s.x || 1) : k, k, d ? d / (s.z || 1) : k);
  o.updateMatrixWorld(true);
  const b = new Box3().setFromObject(o);
  const c = b.getCenter(new Vector3());
  o.position.x -= c.x; o.position.z -= c.z; o.position.y -= b.min.y;
  if (Object.keys(tint).length) o.traverse(x => {
    if (!(x instanceof Mesh)) return;
    const mats = [x.material].flat().map(m => {
      const color = tint[(m as { name: string }).name];
      if (!color) return m;
      const n = (m as MeshStandardMaterial).clone();
      n.color.set(color);
      return n;
    });
    x.material = Array.isArray(x.material) ? mats : mats[0];
  });
  const g = new Object3D();
  g.add(o);
  return g;
}

/**
 * Encaixa um móvel: escala uniforme para ter `size` no eixo pedido, base no chão, centralizado em x/z,
 * dentro de um grupo (o grupo vai na posição/rotação final).
 */
export function fit(o: Object3D, size: number, axis: 'x' | 'y' | 'z' = 'x'): Object3D {
  const box = new Box3().setFromObject(o);
  const s = box.getSize(new Vector3());
  const k = size / (s[axis] || 1);
  o.scale.multiplyScalar(k);
  const b2 = new Box3().setFromObject(o);
  const c = b2.getCenter(new Vector3());
  o.position.x -= c.x; o.position.z -= c.z; o.position.y -= b2.min.y;
  const g = new Object3D();
  g.add(o);
  return g;
}
