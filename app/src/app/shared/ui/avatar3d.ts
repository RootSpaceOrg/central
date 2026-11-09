/**
 * Boneco voxel dos agentes (three.js): o Escritório e a prévia do editor de agente usam o mesmo. Carregar só por
 * import dinâmico (o three.js não entra no pacote inicial).
 */
import {
  AmbientLight, BoxGeometry, DirectionalLight, Group, HemisphereLight, Material, Mesh, MeshLambertMaterial, OrthographicCamera, Scene, WebGLRenderer,
} from 'three';

import { AvatarLook, LOOK_DEFAULT, SKINS } from './avatar-look';

/** bonecos um pouco maiores que a escala dos móveis (fica legível de longe) */
export const BODY = 1.3;

// ---------- peças (com cache: centenas de caixas iguais) ----------

const mats = new Map<string, MeshLambertMaterial>();
export const mat = (color: string) => {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new MeshLambertMaterial({ color })));
  return m;
};
const geoBox = new Map<string, BoxGeometry>();
export const boxGeo = (w: number, h: number, d: number) => {
  const k = `${w},${h},${d}`;
  let g = geoBox.get(k);
  if (!g) geoBox.set(k, (g = new BoxGeometry(w, h, d)));
  return g;
};
/** quem desmonta a cena (Escritório) limpa o cache depois de descartar */
export function clearAvatarCaches(): void { geoBox.clear(); mats.clear(); }

export interface Avatar {
  root: Group;
  legL: Group; legR: Group; armL: Group; armR: Group; head: Mesh;
  shirt: MeshLambertMaterial; hair: MeshLambertMaterial;
}

function limb(w: number, h: number, d: number, m: Material, x: number, pivotY: number): Group {
  const g = new Group();
  g.position.set(x, pivotY, 0);
  const mesh = new Mesh(boxGeo(w, h, d), m);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

const piece = (parent: Mesh, w: number, h: number, d: number, m: Material, x: number, y: number, z: number) => {
  const p = new Mesh(boxGeo(w, h, d), m);
  p.position.set(x, y, z);
  p.castShadow = true;
  parent.add(p);
  return p;
};

/**
 * De frente para +z, pés em y = 0. Cabelo na cor do agente; roupa na cor do projeto (ou a do agente, no look).
 * O look escolhe o penteado, o acessório e a pele (sem look = o boneco padrão, pele pela chave).
 */
export function avatar(hairColor: string, shirtColor: string, skinColor: string, look: AvatarLook = LOOK_DEFAULT): Avatar {
  const root = new Group();
  const shirt = new MeshLambertMaterial({ color: look.outfit || shirtColor });
  const hair = new MeshLambertMaterial({ color: hairColor });
  const skin = mat(look.skin >= 0 ? SKINS[look.skin % SKINS.length] : skinColor), pants = mat('#2b3242'), dark = mat('#14171d');
  const legL = limb(0.17, 0.45, 0.19, pants, -0.1, 0.45), legR = limb(0.17, 0.45, 0.19, pants, 0.1, 0.45);
  const armL = limb(0.12, 0.4, 0.14, shirt, -0.28, 0.86), armR = limb(0.12, 0.4, 0.14, shirt, 0.28, 0.86);
  const torso = new Mesh(boxGeo(0.44, 0.45, 0.27), shirt);
  torso.position.y = 0.675; torso.castShadow = true;
  const head = new Mesh(boxGeo(0.4, 0.37, 0.36), skin);
  head.position.y = 1.09; head.castShadow = true;
  piece(head, 0.06, 0.07, 0.01, dark, -0.085, 0.01, 0.181);
  piece(head, 0.06, 0.07, 0.01, dark, 0.085, 0.01, 0.181);

  // cabelo
  switch (look.hair) {
    case 'careca': break;
    case 'longo':
      piece(head, 0.43, 0.12, 0.39, hair, 0, 0.24, 0);
      piece(head, 0.43, 0.5, 0.08, hair, 0, -0.04, -0.17);
      piece(head, 0.05, 0.36, 0.3, hair, -0.21, 0.02, -0.02);
      piece(head, 0.05, 0.36, 0.3, hair, 0.21, 0.02, -0.02);
      break;
    case 'rabo':
      piece(head, 0.43, 0.12, 0.39, hair, 0, 0.24, 0);
      piece(head, 0.43, 0.22, 0.08, hair, 0, 0.1, -0.17);
      piece(head, 0.12, 0.34, 0.12, hair, 0, -0.06, -0.26);
      break;
    case 'coque':
      piece(head, 0.43, 0.1, 0.39, hair, 0, 0.23, 0);
      piece(head, 0.43, 0.22, 0.08, hair, 0, 0.1, -0.17);
      piece(head, 0.2, 0.16, 0.18, hair, 0, 0.33, -0.08);
      break;
    case 'moicano':
      piece(head, 0.1, 0.2, 0.36, hair, 0, 0.27, -0.01);
      break;
    case 'cacheado':
      piece(head, 0.5, 0.2, 0.46, hair, 0, 0.25, -0.01);
      piece(head, 0.5, 0.3, 0.1, hair, 0, 0.06, -0.2);
      piece(head, 0.06, 0.24, 0.36, hair, -0.24, 0.12, -0.02);
      piece(head, 0.06, 0.24, 0.36, hair, 0.24, 0.12, -0.02);
      break;
    default: // curto
      piece(head, 0.43, 0.12, 0.39, hair, 0, 0.24, 0);
      piece(head, 0.43, 0.27, 0.08, hair, 0, 0.07, -0.17);
  }

  // acessório
  const accent = mat(look.outfit || '#c0705a');
  switch (look.acc) {
    case 'oculos':
      piece(head, 0.13, 0.1, 0.02, dark, -0.085, 0.01, 0.19);
      piece(head, 0.13, 0.1, 0.02, dark, 0.085, 0.01, 0.19);
      piece(head, 0.06, 0.025, 0.02, dark, 0, 0.03, 0.19);
      break;
    case 'fone':
      piece(head, 0.48, 0.05, 0.08, dark, 0, 0.32, 0);
      piece(head, 0.06, 0.16, 0.14, dark, -0.23, 0.02, 0);
      piece(head, 0.06, 0.16, 0.14, dark, 0.23, 0.02, 0);
      piece(head, 0.03, 0.03, 0.14, dark, -0.21, -0.07, 0.1);
      break;
    case 'gorro':
      piece(head, 0.46, 0.2, 0.42, accent, 0, 0.25, 0);
      piece(head, 0.1, 0.08, 0.1, accent, 0, 0.39, 0);
      break;
    case 'bone':
      piece(head, 0.45, 0.13, 0.41, accent, 0, 0.25, 0);
      piece(head, 0.4, 0.03, 0.18, accent, 0, 0.2, 0.25);
      break;
    case 'barba':
      piece(head, 0.38, 0.14, 0.05, hair, 0, -0.12, 0.17);
      piece(head, 0.16, 0.04, 0.03, hair, 0, -0.04, 0.19);
      break;
  }

  root.add(legL, legR, armL, armR, torso, head);
  root.scale.setScalar(BODY);
  return { root, legL, legR, armL, armR, head, shirt, hair };
}

/** Prévia girando (editor de agente): um boneco, luz e câmera; para quando sai da tela. */
export class AvatarPreview {
  private readonly renderer = new WebGLRenderer({ antialias: true, alpha: true });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-0.75, 0.75, 1.0, -1.0, 0.1, 20);
  private av: Avatar | null = null;
  private raf = 0;

  constructor(private readonly host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(this.renderer.domElement);
    const aspect = host.clientWidth / host.clientHeight;
    // boneco de -0.55 a ~1.2 (com cabelo/gorro): enquadra com folga
    Object.assign(this.camera, { left: -1.05 * aspect, right: 1.05 * aspect, top: 1.05, bottom: -1.05 });
    this.camera.position.set(0, 0.85, 5);
    this.camera.lookAt(0, 0.32, 0);
    this.camera.updateProjectionMatrix();
    const sun = new DirectionalLight('#fff3e0', 2.0);
    sun.position.set(2, 4, 4);
    this.scene.add(new HemisphereLight('#dfe8ff', '#3a3328', 1.4), new AmbientLight('#ffffff', 0.4), sun);
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      if (this.av) {
        this.av.root.rotation.y = Math.sin(t / 1400) * 0.9;
        this.av.armL.rotation.x = Math.sin(t / 300) * 0.08;
        this.av.armR.rotation.x = -this.av.armL.rotation.x;
      }
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  show(hair: string, shirt: string, skin: string, look: AvatarLook): void {
    if (this.av) this.scene.remove(this.av.root);
    this.av = avatar(hair, shirt, skin, look);
    this.av.root.position.y = -0.55;
    this.scene.add(this.av.root);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
