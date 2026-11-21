import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Rng } from '../util/rng';

// Personagens feitos no Blender (tools/blender/make_people.py): corpo com
// esqueleto e partes codificadas na cor de vértice. Aqui cada pessoa ganha
// cores próprias com um único material e pode ser posada osso a osso.

export interface Look {
  skin: string;
  shirt: string;
  pants: string;
  /** canela: cor da calça (calça comprida) ou da pele (bermuda) */
  shin: string;
  /** antebraço: pele (manga curta) ou camisa (manga longa) */
  forearm: string;
  shoes: string;
  hair: string;
  cap: string;
}

const SKINS = ['#f2c9a8', '#e0ad86', '#c8875c', '#9b6340', '#734a32', '#eab894'];
const HAIRS = ['#d8d6d0', '#b9b7b2', '#9a9894', '#3a2c24', '#1d1a18', '#6f5543', '#efeee9'];
const SHIRTS = ['#f4f4f2', '#8a97a5', '#25344d', '#c23a32', '#2f7f53', '#f2cf45', '#1f2023', '#e3843c', '#3d6fa1', '#7d4f8f', '#a9c7e8', '#5c6b3a', '#e6e0d0', '#b23b6a'];
const PANTS = ['#2f3c55', '#3d4f6e', '#4a4f57', '#1f2328', '#6c5d4c', '#c9b896', '#556070', '#28324a'];
const SHOES = ['#25262a', '#f0efea', '#6b4a32', '#3b4b6b', '#1c1c1c'];
const CAPS = ['#f2f2f2', '#1f3b70', '#b52222', '#2b2b2b', '#e1c043', '#2f6b3f', '#c9c3b5'];

export function randomLook(rng: Rng, shirt?: string): Look {
  const skin = rng.pick(SKINS);
  const s = shirt ?? rng.pick(SHIRTS);
  const pants = rng.pick(PANTS);
  const shorts = rng.next() < 0.35;
  const longSleeve = rng.next() < 0.2;
  const flipflop = shorts && rng.next() < 0.6;
  return {
    skin,
    shirt: s,
    pants,
    shin: shorts ? skin : pants,
    forearm: longSleeve ? s : skin,
    shoes: flipflop ? skin : rng.pick(SHOES),
    hair: rng.pick(HAIRS),
    cap: rng.pick(CAPS),
  };
}

const PART_KEYS: (keyof Look | 'dark')[] = ['skin', 'shirt', 'pants', 'shoes', 'hair', 'cap', 'dark', 'shin', 'forearm'];

function peopleMaterial(look: Look): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  const uniforms: Record<string, { value: THREE.Color }> = {};
  for (const k of PART_KEYS) uniforms['u_' + k] = { value: new THREE.Color(k === 'dark' ? '#15110e' : look[k as keyof Look]) };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = floor(color.r * 10.0);');
    const decl = PART_KEYS.map((k) => `uniform vec3 u_${k};`).join('\n');
    const pick = PART_KEYS.map((k, i) => `${i === 0 ? '' : 'else '}if (vPart < ${i}.5) partColor = u_${k};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vPart;\n${decl}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nvec3 partColor = u_skin;\n${pick}\ndiffuseColor.rgb = partColor;`);
  };
  mat.customProgramCacheKey = () => 'bocha-people';
  return mat;
}

export type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'upper_arm.L'
  | 'forearm.L'
  | 'hand.L'
  | 'upper_arm.R'
  | 'forearm.R'
  | 'hand.R'
  | 'thigh.L'
  | 'shin.L'
  | 'foot.L'
  | 'thigh.R'
  | 'shin.R'
  | 'foot.R';

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** Uma pessoa: olha para +Z local, esquerda em +X. */
export class Character {
  readonly root: THREE.Object3D;
  readonly mesh: THREE.SkinnedMesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly restLocal = new Map<string, THREE.Quaternion>();
  /** rotação de repouso do pai, no espaço do personagem */
  private readonly parentRest = new Map<string, THREE.Quaternion>();
  private readonly hipsRest = new THREE.Vector3();

  constructor(source: THREE.Object3D, look: Look) {
    this.root = cloneSkinned(source);
    this.root.position.set(0, 0, 0);
    let mesh: THREE.SkinnedMesh | null = null;
    this.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
      // o GLTFLoader tira os pontos dos nomes (upper_arm.L -> upper_armL) e numera repetidos (hips_1)
      if ((o as THREE.Bone).isBone) this.bones.set(o.name.replace(/\./g, '').replace(/_\d+$/, ''), o as THREE.Bone);
    });
    if (!mesh) throw new Error('personagem sem malha com esqueleto');
    this.mesh = mesh;
    this.material = peopleMaterial(look);
    this.mesh.material = this.material;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const [name, b] of this.bones) {
      this.restLocal.set(name, b.quaternion.clone());
      const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      this.parentRest.set(name, rootQ.clone().multiply(pq));
    }
    this.hipsRest.copy(this.bone('hips').position);
  }

  bone(name: BoneName): THREE.Bone {
    const b = this.bones.get(name.replace(/\./g, ''));
    if (!b) throw new Error(`osso ${name} não encontrado`);
    return b;
  }

  setLook(look: Partial<Look>): void {
    const u = this.material.userData.uniforms as Record<string, { value: THREE.Color }>;
    for (const [k, v] of Object.entries(look)) if (v) u['u_' + k].value.set(v);
  }

  /**
   * Gira um osso, relativo ao repouso, em torno de eixos do espaço do
   * personagem (x = lateral, y = vertical, z = frente). Ângulos em radianos.
   */
  rotate(name: BoneName, x: number, y = 0, z = 0, order: THREE.EulerOrder = 'XYZ'): void {
    const key = name.replace(/\./g, '');
    const b = this.bones.get(key);
    if (!b) return;
    const rp = this.parentRest.get(key)!;
    tmpQ.setFromEuler(tmpE.set(x, y, z, order));
    // Lb' = (Rp^-1 · D · Rp) · Lb
    const d = rp.clone().invert().multiply(tmpQ).multiply(rp);
    b.quaternion.copy(d).multiply(this.restLocal.get(key)!);
  }

  /** desloca o quadril (agachar) */
  setHipsOffset(dy: number, dz = 0): void {
    const h = this.bone('hips');
    h.position.set(this.hipsRest.x, this.hipsRest.y + dy, this.hipsRest.z + dz);
  }

  resetPose(): void {
    for (const [name, b] of this.bones) b.quaternion.copy(this.restLocal.get(name)!);
    this.setHipsOffset(0);
  }

  setOpacity(o: number): void {
    const t = o < 0.99;
    this.material.transparent = t;
    this.material.opacity = o;
    this.material.depthWrite = !t;
  }

  dispose(): void {
    this.material.dispose();
  }
}

export class CharacterKit {
  readonly variants: THREE.Object3D[];

  private constructor(variants: THREE.Object3D[]) {
    this.variants = variants;
  }

  static async load(url: string): Promise<CharacterKit> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const variants: THREE.Object3D[] = [];
    for (const c of gltf.scene.children) if (c.name.startsWith('rig_')) variants.push(c);
    if (!variants.length) throw new Error('nenhum personagem no arquivo');
    variants.sort((a, b) => a.name.localeCompare(b.name));
    return new CharacterKit(variants);
  }

  variantIndex(name: string): number {
    const i = this.variants.findIndex((v) => v.name === 'rig_' + name);
    return i < 0 ? 0 : i;
  }

  create(variant: number, look: Look): Character {
    return new Character(this.variants[((variant % this.variants.length) + this.variants.length) % this.variants.length], look);
  }
}
