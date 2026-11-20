import * as THREE from 'three';
import type { CourtSpec } from '../config';
import { Rng } from '../util/rng';
import { canvas, clayMacroTexture, concreteTexture, plaqueCanvas, roofTexture, tileTexture, woodTexture, type ClayTextures } from './textures';
import type { VenueStyle } from './venueStyle';

export interface ScoreInfo {
  blue: number;
  red: number;
  round: number;
  target: number;
  training: boolean;
}

/** Cancha, tabelas, marcações e cobertura de cada ambiente. Reconstruída ao trocar de cancha ou de dimensões. */
export class CourtView {
  readonly group = new THREE.Group();
  readonly spec: CourtSpec;
  private readonly disposables: { dispose(): void }[] = [];
  private plaqueCtx: CanvasRenderingContext2D;
  private plaqueTex: THREE.CanvasTexture;

  readonly style: VenueStyle;
  /** pontos de luz (lâmpadas) — usados pelo ambiente noturno */
  readonly lampPositions: THREE.Vector3[] = [];

  constructor(spec: CourtSpec, style: VenueStyle, floor: ClayTextures) {
    this.spec = spec;
    this.style = style;
    this.buildFloor(floor);
    this.buildLines();
    this.buildWalls();
    if (style.roof === 'steel') this.buildStructure();
    else if (style.roof === 'tiles') this.buildTileRoof();
    else if (style.roof === 'bulbs') this.buildBulbs();
    else this.buildGym();
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
    const st = this.style;
    const concrete = this.track(concreteTexture());
    const boardMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(woodTexture(st.board)), roughness: 0.7 }));
    const concreteMat =
      st.wall.kind === 'wood'
        ? this.track(new THREE.MeshStandardMaterial({ map: this.track(woodTexture(st.wall.color)), roughness: 0.75 }))
        : this.track(new THREE.MeshStandardMaterial({ map: concrete, color: st.wall.color, roughness: 0.92 }));
    const capMat =
      st.cap.kind === 'wood'
        ? this.track(new THREE.MeshStandardMaterial({ map: this.track(woodTexture(st.cap.color)), roughness: 0.65 }))
        : this.track(new THREE.MeshStandardMaterial({ map: concrete, color: st.cap.color, roughness: 0.9 }));

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
    const walkMesh = new THREE.Mesh(walk, this.track(new THREE.MeshStandardMaterial({ map: walkTex, color: st.walkway, roughness: 0.95 })));
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
    const roof = this.style.roof;
    const y = roof === 'tiles' ? 2.75 : roof === 'bulbs' ? 2.05 : roof === 'indoor' ? 3.7 : 3.45;
    const z = roof === 'bulbs' ? -L - 0.45 : -L + 0.35;
    const geo = this.track(new THREE.PlaneGeometry(2.6, 0.65));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: this.plaqueTex, roughness: 0.6, emissive: '#ffffff', emissiveMap: this.plaqueTex, emissiveIntensity: 0.35 }));
    const plaque = new THREE.Mesh(geo, mat);
    plaque.position.set(0, y, z);
    this.group.add(plaque);
    const brown = this.track(new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.7 }));
    const frame = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.72, 0.77, 0.05)), brown);
    frame.position.set(0, y, z - 0.03);
    this.group.add(frame);
    if (roof === 'bulbs') {
      // placa em dois postes atrás do fundo
      const post = this.track(new THREE.CylinderGeometry(0.05, 0.06, y + 0.4, 8));
      for (const x of [-1.2, 1.2]) {
        const p = new THREE.Mesh(post, brown);
        p.position.set(x, (y + 0.4) / 2, z - 0.08);
        p.castShadow = true;
        this.group.add(p);
      }
    } else {
      const top = roof === 'tiles' ? 3.75 : roof === 'indoor' ? 7.2 : 5.6;
      const len = top - (y + 0.38);
      const wire = this.track(new THREE.CylinderGeometry(0.008, 0.008, len));
      const wireMat = this.track(new THREE.MeshStandardMaterial({ color: '#333' }));
      for (const x of [-1.1, 1.1]) {
        const w = new THREE.Mesh(wire, wireMat);
        w.position.set(x, y + 0.38 + len / 2, z - 0.03);
        this.group.add(w);
      }
    }
    this.setScore({ blue: 0, red: 0, round: 1, target: 12, training: false });
  }

  /** comunidade do interior: esteios e tesouras de madeira, telha de barro */
  private buildTileRoof(): void {
    const { length: L, width: W } = this.spec;
    const postX = W / 2 + 1.35;
    const eave = 3.75;
    const ridge = 4.9;
    const woodMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(woodTexture('#6a4a2c')), roughness: 0.8 }));
    const beamGeo = this.track(new THREE.BoxGeometry(1, 1, 1));
    const mats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const beam = (a: THREE.Vector3, b: THREE.Vector3, w: number) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      mats.push(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(w, len, w)));
    };
    const bays = Math.max(3, Math.round(L / 4));
    const zA = 1.0;
    const zB = -L - 1.0;
    for (let i = 0; i <= bays; i++) {
      const z = zA + (i / bays) * (zB - zA);
      for (const sx of [-1, 1]) beam(new THREE.Vector3(sx * postX, 0, z), new THREE.Vector3(sx * postX, eave, z), 0.16);
      beam(new THREE.Vector3(-postX - 0.6, eave - 0.25, z), new THREE.Vector3(0, ridge, z), 0.12);
      beam(new THREE.Vector3(postX + 0.6, eave - 0.25, z), new THREE.Vector3(0, ridge, z), 0.12);
      beam(new THREE.Vector3(-postX, eave, z), new THREE.Vector3(postX, eave, z), 0.11);
    }
    for (const sx of [-1, 1]) beam(new THREE.Vector3(sx * postX, eave, zA), new THREE.Vector3(sx * postX, eave, zB), 0.13);
    beam(new THREE.Vector3(0, ridge, zA), new THREE.Vector3(0, ridge, zB), 0.13);
    const inst = new THREE.InstancedMesh(beamGeo, woodMat, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    // a cobertura não projeta sombra na cancha (iluminação difusa de baixo do telhado)
    inst.castShadow = false;
    this.group.add(inst);
    const tiles = this.track(tileTexture());
    const run = Math.hypot(postX + 0.9, ridge - eave + 0.25);
    tiles.repeat.set(run * 2.6, (zA - zB) * 2.6);
    const tileMat = this.track(new THREE.MeshStandardMaterial({ map: tiles, side: THREE.DoubleSide, roughness: 0.85 }));
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(run, zA - zB + 0.4)), tileMat);
      m.rotation.order = 'ZXY';
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -sx * Math.atan2(ridge - eave + 0.25, postX + 0.9);
      m.position.set((sx * (postX + 0.9)) / 2, (ridge + eave - 0.25) / 2 + 0.08, (zA + zB) / 2);
      this.group.add(m);
    }
    // lâmpadas penduradas na cumeeira
    this.hangingBulbs(
      Array.from({ length: bays }, (_, i) => new THREE.Vector3(0, ridge - 0.5, zA + ((i + 0.5) / bays) * (zB - zA))),
      ridge,
    );
  }

  /** bar de esquina: postes de madeira e varal de lâmpadas em zigue-zague sobre a cancha */
  private buildBulbs(): void {
    const { length: L, width: W } = this.spec;
    const poleX = W / 2 + 0.75;
    const top = 4.6;
    const woodMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(woodTexture('#5a4330')), roughness: 0.85 }));
    const poleGeo = this.track(new THREE.CylinderGeometry(0.07, 0.09, top, 8));
    const n = Math.max(3, Math.round(L / 6));
    const tops: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const z = 0.6 - (i / n) * (L + 1.2);
      // alterna o lado do poste: o fio cruza a cancha em zigue-zague
      const sx = i % 2 === 0 ? -1 : 1;
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(poleGeo, woodMat);
        p.position.set(side * poleX, top / 2, z);
        p.castShadow = true;
        this.group.add(p);
      }
      tops.push(new THREE.Vector3(sx * poleX, top - 0.15, z));
    }
    const bulbs: THREE.Vector3[] = [];
    const wirePts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = tops[i];
      const b = tops[i + 1];
      const segs = 14;
      for (let k = 0; k < segs; k++) {
        const p0 = a.clone().lerp(b, k / segs);
        p0.y -= Math.sin((Math.PI * k) / segs) * 0.55;
        const p1 = a.clone().lerp(b, (k + 1) / segs);
        p1.y -= Math.sin((Math.PI * (k + 1)) / segs) * 0.55;
        wirePts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        if (k > 0 && k % 2 === 0) bulbs.push(p0.clone().add(new THREE.Vector3(0, -0.12, 0)));
      }
    }
    const wireGeo = this.track(new THREE.BufferGeometry());
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    this.group.add(new THREE.LineSegments(wireGeo, this.track(new THREE.LineBasicMaterial({ color: '#1c1c1c' }))));
    const bulbMat = this.track(new THREE.MeshStandardMaterial({ color: '#fff3c8', emissive: '#ffcf70', emissiveIntensity: 3 }));
    const bulb = new THREE.InstancedMesh(this.track(new THREE.SphereGeometry(0.055, 10, 8)), bulbMat, bulbs.length);
    bulbs.forEach((b, i) => bulb.setMatrixAt(i, new THREE.Matrix4().makeTranslation(b.x, b.y, b.z)));
    this.group.add(bulb);
    this.lampPositions.push(...bulbs);
  }

  /** ginásio: prédio fechado, paredes claras, luminárias e janelas altas */
  private buildGym(): void {
    const { length: L, width: W } = this.spec;
    const hx = W / 2 + 4.5;
    const z0 = 4.5;
    const z1 = -L - 4.5;
    const H = 7.2;
    const wallMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(concreteTexture()), color: '#e8e2d4', roughness: 0.95, side: THREE.BackSide }));
    const box = new THREE.Mesh(this.track(new THREE.BoxGeometry(hx * 2, H, z0 - z1)), wallMat);
    box.position.set(0, H / 2 - 0.02, (z0 + z1) / 2);
    box.receiveShadow = true;
    this.group.add(box);
    // barrado azul nas quatro paredes (só painéis: uma caixa cobriria o piso)
    const bandMat = this.track(new THREE.MeshStandardMaterial({ color: '#2f6f9e', roughness: 0.8 }));
    const depth = z0 - z1;
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(this.track(new THREE.PlaneGeometry(depth, 1.4)), bandMat);
      p.position.set(sx * (hx - 0.03), 0.7, (z0 + z1) / 2);
      p.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(p);
    }
    for (const [z, ry] of [
      [z0 - 0.03, Math.PI],
      [z1 + 0.03, 0],
    ] as const) {
      const p = new THREE.Mesh(this.track(new THREE.PlaneGeometry(hx * 2, 1.4)), bandMat);
      p.position.set(0, 0.7, z);
      p.rotation.y = ry;
      this.group.add(p);
    }
    const winMat = this.track(new THREE.MeshStandardMaterial({ color: '#cfe6ff', emissive: '#bcdcff', emissiveIntensity: 0.9 }));
    const winGeo = this.track(new THREE.PlaneGeometry(2.2, 1.1));
    for (let z = z0 - 3; z > z1 + 2; z -= 4) {
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(winGeo, winMat);
        w.position.set(sx * (hx - 0.02), H - 1.5, z);
        w.rotation.y = (-sx * Math.PI) / 2;
        this.group.add(w);
      }
    }
    const lampMat = this.track(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fffdf2', emissiveIntensity: 1.8 }));
    const lampGeo = this.track(new THREE.BoxGeometry(0.25, 0.06, 1.4));
    const rows: THREE.Matrix4[] = [];
    for (let z = z0 - 2.5; z > z1 + 1; z -= 3.2) for (const x of [-2.6, 0, 2.6]) rows.push(new THREE.Matrix4().makeTranslation(x, H - 0.25, z));
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, rows.length);
    rows.forEach((m, i) => lamps.setMatrixAt(i, m));
    this.group.add(lamps);
    const banners: [number, string, string][] = [
      [-1, 'TORNEIO MUNICIPAL DE BOCHA', '#c62828'],
      [1, 'BOCHA É TRADIÇÃO', '#1d5fd1'],
    ];
    for (const [sx, text, color] of banners) {
      const [c, ctx] = canvas(1024, 160);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1024, 160);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 92px "Barlow Condensed", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 512, 84);
      const t = this.track(new THREE.CanvasTexture(c));
      t.colorSpace = THREE.SRGBColorSpace;
      const banner = new THREE.Mesh(this.track(new THREE.PlaneGeometry(8, 1.25)), this.track(new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })));
      banner.position.set(sx * (hx - 0.03), 3.6, -L / 2);
      banner.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(banner);
    }
  }

  private hangingBulbs(points: THREE.Vector3[], top: number): void {
    const bulbMat = this.track(new THREE.MeshStandardMaterial({ color: '#fff3c8', emissive: '#ffd27a', emissiveIntensity: 2.6 }));
    const cord = this.track(new THREE.MeshStandardMaterial({ color: '#222' }));
    const bulbGeo = this.track(new THREE.SphereGeometry(0.07, 10, 8));
    for (const p of points) {
      const b = new THREE.Mesh(bulbGeo, bulbMat);
      b.position.copy(p);
      const len = top - p.y;
      const c = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.006, 0.006, len)), cord);
      c.position.set(p.x, p.y + len / 2, p.z);
      this.group.add(b, c);
      this.lampPositions.push(p.clone());
    }
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
    ctx.fillText(s.training ? `${this.style.plaque} · TREINO LIVRE` : `${this.style.plaque} · RODADA ${s.round} · ATÉ ${s.target}`, w / 2, 52);
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
