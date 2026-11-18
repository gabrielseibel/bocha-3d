import * as THREE from 'three';
import type { CourtSpec } from '../config';
import { Rng } from '../util/rng';
import { canvas, clayMacroTexture, concreteTexture, plaqueCanvas, roofTexture, woodTexture, type ClayTextures } from './textures';

const BLUE_PAINT = '#2d5f97';

export interface ScoreInfo {
  blue: number;
  red: number;
  round: number;
  target: number;
  training: boolean;
}

/** Cancha, tabelas, marcações e a cobertura metálica. Reconstruída quando as dimensões mudam. */
export class CourtView {
  readonly group = new THREE.Group();
  readonly spec: CourtSpec;
  private readonly disposables: { dispose(): void }[] = [];
  private plaqueCtx: CanvasRenderingContext2D;
  private plaqueTex: THREE.CanvasTexture;

  constructor(spec: CourtSpec, clay: ClayTextures) {
    this.spec = spec;
    this.buildFloor(clay);
    this.buildLines();
    this.buildWalls();
    this.buildStructure();
    const [, ctx, tex] = plaqueCanvas();
    this.plaqueCtx = ctx;
    this.plaqueTex = tex;
    this.disposables.push(tex);
    this.buildPlaque();
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private buildFloor(clay: ClayTextures): void {
    const { length: L, width: W } = this.spec;
    const geo = this.track(new THREE.PlaneGeometry(W, L, 1, 1));
    geo.rotateX(-Math.PI / 2);
    const tile = 1.35;
    const map = clay.map.clone();
    map.repeat.set(W / tile, L / tile);
    map.needsUpdate = true;
    const normal = clay.normal.clone();
    normal.repeat.copy(map.repeat);
    normal.needsUpdate = true;
    this.track(map);
    this.track(normal);
    const macro = this.track(clayMacroTexture());
    const mat = this.track(
      new THREE.MeshStandardMaterial({
        map,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.96,
        metalness: 0,
      }),
    );
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.macroMap = { value: macro };
      shader.uniforms.courtSize = { value: new THREE.Vector2(W, L) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 courtSize;\nvarying vec2 vMacroUv;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvec4 mw = modelMatrix * vec4(transformed, 1.0);\nvMacroUv = vec2(mw.x / courtSize.x + 0.5, -mw.z / courtSize.y);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D macroMap;\nvarying vec2 vMacroUv;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(macroMap, vMacroUv).r * 2.0;');
    };
    const floor = new THREE.Mesh(geo, mat);
    floor.position.set(0, 0, -L / 2);
    floor.receiveShadow = true;
    floor.name = 'court-floor';
    this.group.add(floor);
  }

  private chalkTexture(dashed: boolean): THREE.CanvasTexture {
    const [c, ctx] = canvas(512, 16);
    const rng = new Rng(dashed ? 5 : 3);
    for (let x = 0; x < 512; x++) {
      if (dashed && Math.floor(x / 24) % 2 === 1) continue;
      for (let y = 2; y < 14; y++) {
        const a = rng.range(0.55, 0.95) * (y < 4 || y > 11 ? 0.5 : 1);
        ctx.fillStyle = `rgba(250,248,240,${a})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return this.track(t);
  }

  private buildLines(): void {
    const { width: W, foulLine, bolimMin, bolimMax } = this.spec;
    const make = (s: number, dashed: boolean, opacity: number, thickness: number) => {
      const geo = this.track(new THREE.PlaneGeometry(W - 0.02, thickness));
      geo.rotateX(-Math.PI / 2);
      const mat = this.track(
        new THREE.MeshStandardMaterial({
          map: this.chalkTexture(dashed),
          transparent: true,
          opacity,
          roughness: 1,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, 0.002, -s);
      m.receiveShadow = true;
      this.group.add(m);
    };
    make(foulLine, false, 0.95, 0.05);
    make(bolimMin, true, 0.45, 0.035);
    make(bolimMax, true, 0.45, 0.035);
  }

  private buildWalls(): void {
    const { length: L, width: W, sideWallHeight: H, endWallHeight: HE } = this.spec;
    const T = 0.16;
    const board = 0.3;
    const concrete = this.track(concreteTexture());
    const wood = this.track(woodTexture('#8d6238'));
    const paintedWood = this.track(woodTexture(BLUE_PAINT));
    const concreteMat = this.track(new THREE.MeshStandardMaterial({ map: concrete, color: '#f2f0ea', roughness: 0.92 }));
    const boardMat = this.track(new THREE.MeshStandardMaterial({ map: paintedWood, roughness: 0.7 }));
    const capMat = this.track(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.65 }));

    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, uvScale = 1) => {
      const g = this.track(new THREE.BoxGeometry(w, h, d));
      if (uvScale !== 1) {
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uvScale);
      }
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    for (const side of [-1, 1]) {
      const x = side * (W / 2 + T / 2);
      box(T, board, L + 2 * T, boardMat, x, board / 2, -L / 2, L / 2.5);
      box(T, H - board, L + 2 * T, concreteMat, x, board + (H - board) / 2, -L / 2, L / 3);
      box(T + 0.12, 0.05, L + 2 * T + 0.12, capMat, side * (W / 2 + T / 2 + 0.03), H + 0.025, -L / 2, L / 4);
    }
    // fundo
    box(W + 2 * T, 0.42, T, boardMat, 0, 0.21, -L - T / 2, 2);
    box(W + 2 * T, HE - 0.42, T, concreteMat, 0, 0.42 + (HE - 0.42) / 2, -L - T / 2, 2);
    box(W + 2 * T + 0.12, 0.05, T + 0.12, capMat, 0, HE + 0.025, -L - T / 2 - 0.03, 2);
    // cabeceira de arremesso (baixa)
    box(W + 2 * T, 0.3, T, boardMat, 0, 0.15, T / 2, 2);
    box(W + 2 * T, 0.25, T, concreteMat, 0, 0.425, T / 2, 2);
    box(W + 2 * T + 0.12, 0.05, T + 0.12, capMat, 0, 0.575, T / 2 + 0.03, 2);

    // calçada de cimento em volta
    const walk = this.track(new THREE.PlaneGeometry(W + 7, L + 9));
    walk.rotateX(-Math.PI / 2);
    const walkTex = concrete.clone();
    walkTex.repeat.set((W + 7) / 2, (L + 9) / 2);
    walkTex.needsUpdate = true;
    this.track(walkTex);
    const walkMesh = new THREE.Mesh(walk, this.track(new THREE.MeshStandardMaterial({ map: walkTex, color: '#c9c6bd', roughness: 0.95 })));
    walkMesh.position.set(0, -0.012, -L / 2 + 1.2);
    walkMesh.receiveShadow = true;
    this.group.add(walkMesh);
  }

  private buildStructure(): void {
    const { length: L, width: W } = this.spec;
    const colX = W / 2 + 1.9;
    const eave = 5.6;
    const ridge = 6.9;
    const steel = this.track(new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.5, metalness: 0.35 }));
    const darkSteel = this.track(new THREE.MeshStandardMaterial({ color: '#59616a', roughness: 0.55, metalness: 0.4 }));
    const beamGeo = this.track(new THREE.BoxGeometry(1, 1, 1));
    const beams: THREE.Matrix4[] = [];
    const darkBeams: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const addBeam = (a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, list = beams) => {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = dir.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      list.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(w, len, h)));
    };
    const bays = Math.max(3, Math.round(L / 5));
    const zs: number[] = [];
    for (let i = 0; i <= bays; i++) zs.push(1.2 - (i / bays) * (L + 2.4));
    for (const z of zs) {
      for (const s of [-1, 1]) addBeam(new THREE.Vector3(s * colX, 0, z), new THREE.Vector3(s * colX, eave, z), 0.2, 0.2);
      // treliça: banzo inferior, superiores e diagonais
      addBeam(new THREE.Vector3(-colX, eave, z), new THREE.Vector3(colX, eave, z), 0.07, 0.09, darkBeams);
      addBeam(new THREE.Vector3(-colX - 0.5, eave - 0.1, z), new THREE.Vector3(0, ridge, z), 0.08, 0.1, darkBeams);
      addBeam(new THREE.Vector3(colX + 0.5, eave - 0.1, z), new THREE.Vector3(0, ridge, z), 0.08, 0.1, darkBeams);
      const n = 6;
      for (let k = 1; k < n; k++) {
        for (const s of [-1, 1]) {
          const x0 = s * colX * (1 - k / n);
          const yTop = eave + (ridge - eave) * (k / n);
          addBeam(new THREE.Vector3(x0, eave, z), new THREE.Vector3(x0, yTop, z), 0.04, 0.05, darkBeams);
          const x1 = s * colX * (1 - (k + 1) / n);
          const yTop1 = eave + (ridge - eave) * ((k + 1) / n);
          if (k < n - 1) addBeam(new THREE.Vector3(x0, eave, z), new THREE.Vector3(x1, yTop1, z), 0.035, 0.045, darkBeams);
        }
      }
    }
    // terças longitudinais
    const zA = zs[0];
    const zB = zs[zs.length - 1];
    for (let k = 0; k <= 4; k++) {
      for (const s of [-1, 1]) {
        const t = k / 4;
        const x = s * (colX + 0.5) * (1 - t);
        const y = eave - 0.1 + (ridge - eave + 0.1) * t + 0.08;
        addBeam(new THREE.Vector3(x, y, zA), new THREE.Vector3(x, y, zB), 0.06, 0.12, darkBeams);
      }
    }
    for (const s of [-1, 1]) addBeam(new THREE.Vector3(s * colX, eave - 0.2, zA), new THREE.Vector3(s * colX, eave - 0.2, zB), 0.12, 0.16);
    const inst = new THREE.InstancedMesh(beamGeo, steel, beams.length);
    beams.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = false;
    this.group.add(inst);
    const inst2 = new THREE.InstancedMesh(beamGeo, darkSteel, darkBeams.length);
    darkBeams.forEach((m, i) => inst2.setMatrixAt(i, m));
    this.group.add(inst2);

    // telhas metálicas (dupla face, sem projetar sombra na cancha)
    const roofTex = this.track(roofTexture());
    const roofLen = zA - zB + 1.2;
    const slope = Math.hypot(colX + 1.1, ridge - eave + 0.1);
    roofTex.repeat.set(slope * 2.2, 1);
    const roofMat = this.track(new THREE.MeshStandardMaterial({ map: roofTex, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.3, color: '#c3c9ce' }));
    for (const s of [-1, 1]) {
      const g = this.track(new THREE.PlaneGeometry(slope, roofLen));
      const m = new THREE.Mesh(g, roofMat);
      const ang = Math.atan2(ridge - eave + 0.1, colX + 1.1);
      // deita o plano (Rx) e inclina em torno do eixo longo da cancha (Rz)
      m.rotation.order = 'ZXY';
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -s * ang;
      m.position.set((s * (colX + 1.1)) / 2, (ridge + eave) / 2 + 0.17, (zA + zB) / 2);
      this.group.add(m);
    }

    // luminárias fluorescentes
    const lampMat = this.track(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fffbe8', emissiveIntensity: 1.6, roughness: 0.4 }));
    const housing = this.track(new THREE.MeshStandardMaterial({ color: '#d8dde2', roughness: 0.5, metalness: 0.2 }));
    const lampGeo = this.track(new THREE.BoxGeometry(0.1, 0.04, 1.2));
    const houseGeo = this.track(new THREE.BoxGeometry(0.22, 0.06, 1.28));
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, (zs.length - 1) * 2);
    const houses = new THREE.InstancedMesh(houseGeo, housing, (zs.length - 1) * 2);
    let li = 0;
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < zs.length - 1; i++) {
      const z = (zs[i] + zs[i + 1]) / 2;
      for (const x of [-0.55, 0.55]) {
        mtx.makeTranslation(x, eave - 0.32, z);
        lamps.setMatrixAt(li, mtx);
        mtx.makeTranslation(x, eave - 0.28, z);
        houses.setMatrixAt(li, mtx);
        li++;
      }
    }
    this.group.add(lamps, houses);
  }

  private buildPlaque(): void {
    const { length: L } = this.spec;
    const geo = this.track(new THREE.PlaneGeometry(2.6, 0.65));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: this.plaqueTex, roughness: 0.6, emissive: '#ffffff', emissiveMap: this.plaqueTex, emissiveIntensity: 0.35 }));
    const plaque = new THREE.Mesh(geo, mat);
    plaque.position.set(0, 3.45, -L + 0.35);
    this.group.add(plaque);
    const frame = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.72, 0.77, 0.05)), this.track(new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.7 })));
    frame.position.set(0, 3.45, -L + 0.32);
    this.group.add(frame);
    const wire = this.track(new THREE.CylinderGeometry(0.008, 0.008, 2.1));
    const wireMat = this.track(new THREE.MeshStandardMaterial({ color: '#333' }));
    for (const x of [-1.1, 1.1]) {
      const w = new THREE.Mesh(wire, wireMat);
      w.position.set(x, 3.8 + 1.05, -L + 0.32);
      this.group.add(w);
    }
    this.setScore({ blue: 0, red: 0, round: 1, target: 12, training: false });
  }

  setScore(s: ScoreInfo): void {
    const ctx = this.plaqueCtx;
    const w = 1024;
    const h = 256;
    ctx.fillStyle = '#1d2a22';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = '700 46px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillStyle = '#f4e9c8';
    ctx.fillText(s.training ? 'TREINO LIVRE' : `CLUBE DE BOCHA · RODADA ${s.round} · ATÉ ${s.target}`, w / 2, 52);
    if (!s.training) {
      ctx.font = '800 120px "Barlow Condensed", system-ui, sans-serif';
      ctx.fillStyle = '#6fb0ff';
      ctx.fillText(String(s.blue), w * 0.3, 160);
      ctx.fillStyle = '#ff7a6b';
      ctx.fillText(String(s.red), w * 0.7, 160);
      ctx.fillStyle = '#f4e9c8';
      ctx.font = '700 70px "Barlow Condensed", system-ui, sans-serif';
      ctx.fillText('×', w / 2, 160);
      ctx.font = '700 40px "Barlow Condensed", system-ui, sans-serif';
      ctx.fillStyle = '#6fb0ff';
      ctx.fillText('AZUL', w * 0.12, 160);
      ctx.fillStyle = '#ff7a6b';
      ctx.fillText('VERMELHO', w * 0.88, 160);
    } else {
      ctx.font = '700 64px "Barlow Condensed", system-ui, sans-serif';
      ctx.fillStyle = '#f4e9c8';
      ctx.fillText('BOA BOCHA!', w / 2, 160);
    }
    this.plaqueTex.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
