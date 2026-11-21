import * as THREE from 'three';
import type { CourtSpec } from '../config';
import { Rng } from '../util/rng';
import { brickTexture, canvas, grassTexture, woodTexture } from './textures';
import type { LightPreset, VenueStyle } from './venueStyle';

const SKY: Record<LightPreset, { top: [number, number, number]; horizon: [number, number, number]; clouds: number }> = {
  day: { top: [0.3, 0.55, 0.86], horizon: [0.82, 0.89, 0.94], clouds: 0.55 },
  afternoon: { top: [0.36, 0.52, 0.8], horizon: [0.99, 0.83, 0.63], clouds: 0.4 },
  night: { top: [0.015, 0.03, 0.08], horizon: [0.09, 0.12, 0.21], clouds: 0.04 },
  indoor: { top: [0.3, 0.55, 0.86], horizon: [0.82, 0.89, 0.94], clouds: 0.5 },
};

/** Céu, chão, morros e o entorno de cada cancha. */
export class Environment {
  readonly group = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly hills = new THREE.Group();
  private readonly groundMat: THREE.MeshStandardMaterial;
  private readonly treeCount: number;

  constructor(quality: 'high' | 'medium' | 'low') {
    this.treeCount = quality === 'high' ? 80 : quality === 'medium' ? 52 : 30;
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Vector3(...SKY.day.top) },
        horizon: { value: new THREE.Vector3(...SKY.day.horizon) },
        clouds: { value: SKY.day.clouds },
      },
      vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform float clouds; varying vec3 vp;
        void main(){
          vec3 d = normalize(vp);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
          float cl = sin(d.x*9.0 + d.z*3.0) * sin(d.z*7.0 - d.x*2.0) * 0.5 + 0.5;
          c = mix(c, mix(vec3(0.97), horizon * 1.1, 0.3), smoothstep(0.72, 0.95, cl) * smoothstep(0.05, 0.35, h) * clouds);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 16), this.skyMat);
    sky.renderOrder = -10;
    this.group.add(sky);

    // estrelas (só à noite)
    const rng = new Rng(5);
    const pts: number[] = [];
    for (let i = 0; i < 900; i++) {
      const a = rng.range(0, Math.PI * 2);
      const y = rng.range(0.08, 1);
      const r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(a) * r * 300, y * 300, Math.sin(a) * r * 300 - 12);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.stars.visible = false;
    this.group.add(this.stars);

    const tex = grassTexture();
    tex.repeat.set(90, 90);
    const g = new THREE.PlaneGeometry(420, 420);
    g.rotateX(-Math.PI / 2);
    this.groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const ground = new THREE.Mesh(g, this.groundMat);
    ground.position.set(0, -0.03, -12);
    ground.receiveShadow = true;
    this.group.add(ground);

    const hg = new THREE.SphereGeometry(1, 18, 10);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = rng.range(120, 190);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.27 + rng.range(-0.03, 0.03), 0.35, 0.3 + rng.range(-0.05, 0.05)), roughness: 1, flatShading: true });
      const h = new THREE.Mesh(hg, mat);
      h.scale.set(rng.range(40, 80), rng.range(12, 30), rng.range(30, 60));
      h.position.set(Math.cos(a) * r, -4, -12 + Math.sin(a) * r);
      this.hills.add(h);
    }
    this.group.add(this.hills, this.dynamic);
  }

  /** monta o entorno da cancha escolhida (e a reposiciona quando as dimensões mudam) */
  layout(spec: CourtSpec, style: VenueStyle): void {
    this.dynamic.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.dynamic.clear();
    const sky = SKY[style.light];
    this.skyMat.uniforms.top.value.set(...sky.top);
    this.skyMat.uniforms.horizon.value.set(...sky.horizon);
    this.skyMat.uniforms.clouds.value = sky.clouds;
    this.stars.visible = style.light === 'night';
    this.groundMat.color.set(style.light === 'night' ? '#4d5a52' : style.light === 'afternoon' ? '#f2e2c0' : '#ffffff');
    this.hills.visible = style.light !== 'indoor';
    switch (style.id) {
      case 'clube':
        this.trees(spec, this.treeCount, 'round');
        this.clubhouse(spec);
        this.benches(spec);
        break;
      case 'interior':
        this.trees(spec, Math.round(this.treeCount * 0.45), 'araucaria');
        this.trees(spec, Math.round(this.treeCount * 0.4), 'round', 7);
        this.chapel(spec);
        this.soccerField(spec);
        this.fence(spec);
        this.benches(spec);
        break;
      case 'bar':
        this.trees(spec, Math.round(this.treeCount * 0.25), 'round', 3);
        this.barBuilding(spec);
        this.street(spec);
        break;
      case 'ginasio':
        this.bleachers(spec);
        this.furniture(spec, 1, ['#f4f4f2'], ['#1f2023']);
        break;
      case 'salao':
        this.furniture(spec, -1, ['#f4f4f2', '#f4f4f2', '#d4302b'], ['#f4f4f2', '#2f6f9e']);
        this.furniture(spec, 1, ['#f4f4f2'], ['#f4f4f2', '#2f6f9e']);
        break;
    }
  }

  private add(...o: THREE.Object3D[]): void {
    for (const x of o) {
      x.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) c.castShadow = true;
      });
      this.dynamic.add(x);
    }
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  /** telhado de duas águas sobre uma caixa (largura w ao longo de x, profundidade d) */
  private gable(w: number, d: number, y: number, rise: number, mat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const half = d / 2 + 0.35;
    const slope = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, slope), mat);
      r.rotation.order = 'YXZ';
      r.rotation.x = -Math.PI / 2 + s * ang;
      r.position.set(0, y + rise / 2, (s * half) / 2);
      g.add(r);
    }
    return g;
  }

  private trees(spec: CourtSpec, count: number, kind: 'round' | 'araucaria', seed = 99): void {
    const { length: L, width: W } = spec;
    const rng = new Rng(seed + (kind === 'araucaria' ? 1000 : 0));
    const trunkGeo = new THREE.CylinderGeometry(kind === 'araucaria' ? 0.16 : 0.12, kind === 'araucaria' ? 0.3 : 0.2, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const crownGeo = kind === 'araucaria' ? new THREE.CylinderGeometry(1, 0.55, 0.32, 9) : new THREE.IcosahedronGeometry(1, 1);
    const per = kind === 'araucaria' ? 4 : 2;
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: kind === 'araucaria' ? '#5a4232' : '#5b4330', roughness: 1 }), count);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), count * per);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let placed = 0;
    let ci = 0;
    let guard = 0;
    while (placed < count && guard++ < 5000) {
      const x = rng.range(-75, 75);
      const z = rng.range(-L - 70, 45);
      const blocked = Math.abs(x) < W / 2 + (kind === 'araucaria' ? 9 : 6) && z > -L - 16 && z < 10;
      if (blocked || Math.hypot(x, z + L / 2) > 90) continue;
      if (kind === 'araucaria') {
        // araucária: tronco reto e alto, copa em "candelabro" achatada no topo
        const h = rng.range(9, 15);
        m.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(1, h, 1));
        trunks.setMatrixAt(placed, m);
        for (let k = 0; k < per; k++) {
          const s = rng.range(2.2, 3.4) * (1 - k * 0.18);
          m.compose(new THREE.Vector3(x + rng.range(-0.4, 0.4), h - 1.6 + k * 0.75, z + rng.range(-0.4, 0.4)), q.identity(), new THREE.Vector3(s, 1, s));
          crowns.setMatrixAt(ci, m);
          crowns.setColorAt(ci, col.setHSL(0.3 + rng.range(-0.03, 0.03), 0.42, 0.18 + rng.range(-0.03, 0.04)));
          ci++;
        }
      } else {
        const h = rng.range(3, 7.5);
        m.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(1, h * 0.55, 1));
        trunks.setMatrixAt(placed, m);
        for (let k = 0; k < per; k++) {
          const s = rng.range(1.4, 2.6) * (h / 5);
          q.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)));
          m.compose(new THREE.Vector3(x + rng.range(-0.6, 0.6), h * 0.55 + s * (0.5 + k * 0.6), z + rng.range(-0.6, 0.6)), q, new THREE.Vector3(s, s * rng.range(0.8, 1.1), s));
          crowns.setMatrixAt(ci, m);
          crowns.setColorAt(ci, col.setHSL(0.25 + rng.range(-0.05, 0.06), rng.range(0.35, 0.55), rng.range(0.22, 0.36)));
          ci++;
          q.identity();
        }
      }
      placed++;
    }
    trunks.count = placed;
    crowns.count = ci;
    this.dynamic.add(trunks, crowns);
  }

  private benches(spec: CourtSpec): void {
    const { length: L, width: W } = spec;
    const benchMat = new THREE.MeshStandardMaterial({ map: woodTexture('#7a5230'), roughness: 0.7 });
    for (const s of [-1, 1]) {
      for (const z of [-3, -L * 0.45]) {
        const bench = new THREE.Group();
        bench.add(this.box(0.4, 0.06, 2, benchMat, 0, 0.45, 0));
        for (const dz of [-0.85, 0.85]) bench.add(this.box(0.36, 0.45, 0.06, benchMat, 0, 0.225, dz));
        bench.position.set(s * (W / 2 + 2.7), 0, z);
        this.add(bench);
      }
    }
  }

  /** sede do clube (tijolo à vista) atrás do fundo da cancha */
  private clubhouse(spec: CourtSpec): void {
    const brick = brickTexture();
    brick.repeat.set(5, 2);
    const house = new THREE.Group();
    house.add(this.box(10, 3.2, 5.5, new THREE.MeshStandardMaterial({ map: brick, roughness: 0.95 }), 0, 1.6, 0));
    const roof = this.gable(10, 5.5, 3.2, 1.3, new THREE.MeshStandardMaterial({ color: '#9b4a2c', roughness: 0.85, side: THREE.DoubleSide }));
    house.add(roof);
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6 });
    house.add(this.box(1.1, 2.1, 0.06, dark, -2.5, 1.05, 2.77));
    const glass = new THREE.MeshStandardMaterial({ color: '#43535e', roughness: 0.2, metalness: 0.4 });
    for (const x of [0.6, 3]) house.add(this.box(1.4, 1, 0.06, glass, x, 1.75, 2.77));
    house.position.set(1.5, 0, -spec.length - 9.5);
    this.add(house);
  }

  /** capela de comunidade do interior: paredes brancas, torre do sino e cruz */
  private chapel(spec: CourtSpec): void {
    const L = spec.length;
    const white = new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.9 });
    const tile = new THREE.MeshStandardMaterial({ color: '#a24a2a', roughness: 0.85, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.7 });
    const blue = new THREE.MeshStandardMaterial({ color: '#5d8fc4', roughness: 0.5 });
    const c = new THREE.Group();
    // nave: frente voltada para a cancha (+z)
    const nave = this.box(6, 4.2, 10, white, 0, 2.1, 0);
    c.add(nave);
    const roof = this.gable(10, 6, 4.2, 2.1, tile);
    roof.rotation.y = Math.PI / 2;
    c.add(roof);
    // frontão triangular
    const tri = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 2.1)]);
    const front = new THREE.Mesh(new THREE.ShapeGeometry(tri), white);
    front.position.set(0, 4.2, 5.01);
    c.add(front);
    c.add(this.box(1.5, 2.6, 0.08, dark, 0, 1.3, 5.02));
    const rose = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), blue);
    rose.position.set(0, 4.9, 5.03);
    c.add(rose);
    for (const z of [-2.5, 1]) for (const sx of [-1, 1]) {
      const w = this.box(0.06, 1.5, 0.8, blue, sx * 3.02, 2.4, z);
      c.add(w);
    }
    // torre do sino ao lado
    c.add(this.box(2, 8, 2, white, 4.2, 4, 3.6));
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.55, 2.6, 4), tile);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(4.2, 9.3, 3.6);
    c.add(spire);
    c.add(this.box(0.9, 1.2, 2.04, dark, 4.2, 6.6, 3.6));
    const crossMat = new THREE.MeshStandardMaterial({ color: '#d9c28a', roughness: 0.5, metalness: 0.4 });
    c.add(this.box(0.12, 1.1, 0.12, crossMat, 4.2, 11.1, 3.6), this.box(0.6, 0.12, 0.12, crossMat, 4.2, 11.3, 3.6));
    c.position.set(-7, 0, -L - 14);
    c.rotation.y = 0.18;
    this.add(c);
  }

  private soccerField(spec: CourtSpec): void {
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
    const zc = -spec.length / 2;
    for (const dz of [-22, 22]) {
      const g = new THREE.Group();
      g.add(this.box(0.12, 2.2, 0.12, white, -3.6, 1.1, 0), this.box(0.12, 2.2, 0.12, white, 3.6, 1.1, 0), this.box(7.32, 0.12, 0.12, white, 0, 2.2, 0));
      g.position.set(-32, 0, zc + dz);
      if (dz > 0) g.rotation.y = Math.PI;
      this.add(g);
    }
  }

  private fence(spec: CourtSpec): void {
    const wood = new THREE.MeshStandardMaterial({ color: '#6b5236', roughness: 1 });
    const L = spec.length;
    const posts: THREE.Matrix4[] = [];
    for (let z = 8; z > -L - 30; z -= 3) posts.push(new THREE.Matrix4().makeTranslation(16, 0.6, z));
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), wood, posts.length);
    posts.forEach((m, i) => inst.setMatrixAt(i, m));
    this.dynamic.add(inst);
    const wire = new THREE.MeshStandardMaterial({ color: '#888' });
    for (const y of [0.55, 0.95]) this.dynamic.add(this.box(0.02, 0.02, L + 38, wire, 16, y, (8 + (-L - 30)) / 2));
  }

  /** bar de esquina: fachada pintada, letreiro, toldo, mesas e engradados */
  private barBuilding(spec: CourtSpec): void {
    const W = spec.width;
    const bar = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: '#e07b39', roughness: 0.9 });
    const lit = new THREE.MeshStandardMaterial({ color: '#ffdca0', emissive: '#ffb75e', emissiveIntensity: 1.4 });
    // prédio com frente voltada para a cancha (-x)
    bar.add(this.box(5, 3.3, 9, wall, 0, 1.65, 0));
    bar.add(this.box(5.6, 0.25, 9.6, new THREE.MeshStandardMaterial({ color: '#9c4e24' }), 0, 3.42, 0));
    bar.add(this.box(0.06, 2.3, 2.6, lit, -2.52, 1.15, 1.2));
    bar.add(this.box(0.06, 1.1, 1.6, lit, -2.52, 1.75, -2.6));
    // letreiro
    const [c, ctx] = canvas(512, 128);
    ctx.fillStyle = '#b3241f';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#fff2c4';
    ctx.font = '800 84px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAR DO ZÉ', 256, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.8 }));
    sign.position.set(-2.56, 2.85, 0);
    sign.rotation.y = -Math.PI / 2;
    bar.add(sign);
    // toldo listrado
    const [ac, actx] = canvas(256, 32);
    for (let i = 0; i < 16; i++) {
      actx.fillStyle = i % 2 ? '#f4f1ea' : '#c62828';
      actx.fillRect(i * 16, 0, 16, 32);
    }
    const at = new THREE.CanvasTexture(ac);
    at.colorSpace = THREE.SRGBColorSpace;
    const awning = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 7.5), new THREE.MeshStandardMaterial({ map: at, side: THREE.DoubleSide, roughness: 0.8 }));
    // deitado ao longo da fachada e inclinado para fora (borda de fora mais baixa)
    awning.rotation.order = 'ZXY';
    awning.rotation.x = -Math.PI / 2;
    awning.rotation.z = 0.4;
    awning.position.set(-3.25, 2.4, 0);
    bar.add(awning);
    bar.position.set(W / 2 + 6.2, 0, -4.5);
    this.add(bar);
    // mesas de plástico com garrafas, cadeiras e engradados
    const rng = new Rng(3);
    const tableMats = [new THREE.MeshStandardMaterial({ color: '#d4302b', roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: '#f1c232', roughness: 0.6 })];
    const bottle = new THREE.MeshStandardMaterial({ color: '#4a2a10', roughness: 0.25, metalness: 0.1 });
    for (let i = 0; i < 4; i++) {
      const mat = tableMats[i % 2];
      const t2 = new THREE.Group();
      t2.add(this.box(0.8, 0.04, 0.8, mat, 0, 0.72, 0));
      for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) t2.add(this.box(0.04, 0.72, 0.04, mat, dx, 0.36, dz));
      for (let b = 0; b < 2 + (i % 2); b++) {
        const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), bottle);
        bt.position.set(rng.range(-0.25, 0.25), 0.89, rng.range(-0.25, 0.25));
        t2.add(bt);
      }
      for (const a of [0, Math.PI]) {
        const ch = new THREE.Group();
        ch.add(this.box(0.45, 0.04, 0.45, mat, 0, 0.44, 0), this.box(0.45, 0.45, 0.04, mat, 0, 0.66, -0.22));
        for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) ch.add(this.box(0.03, 0.44, 0.03, mat, dx, 0.22, dz));
        ch.position.set(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6);
        ch.rotation.y = a + Math.PI;
        t2.add(ch);
      }
      t2.position.set(W / 2 + 2.3 + (i % 2) * 1.4, 0, -1.5 - i * 2.4);
      t2.rotation.y = rng.range(-0.3, 0.3);
      this.add(t2);
    }
    const crate = new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.7 });
    for (let k = 0; k < 7; k++) this.add(this.box(0.5, 0.3, 0.36, crate, W / 2 + 3.4 + (k % 2) * 0.55, 0.15 + Math.floor(k / 2) * 0.3, -11.5));
  }

  /** rua com poste e casas de janelas acesas do outro lado da cancha */
  private street(spec: CourtSpec): void {
    const { length: L, width: W } = spec;
    const asphalt = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.95 });
    const curb = new THREE.MeshStandardMaterial({ color: '#9c9890', roughness: 0.9 });
    const x0 = -(W / 2 + 6.5);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(7, L + 90).rotateX(-Math.PI / 2), asphalt);
    road.position.set(x0 - 3.5, -0.02, -L / 2);
    road.receiveShadow = true;
    this.dynamic.add(road);
    this.dynamic.add(this.box(0.2, 0.15, L + 90, curb, x0, 0.05, -L / 2));
    const lampMat = new THREE.MeshStandardMaterial({ color: '#fff1c9', emissive: '#ffd27a', emissiveIntensity: 2.5 });
    const pole = new THREE.MeshStandardMaterial({ color: '#4c4f55', roughness: 0.5, metalness: 0.5 });
    for (const z of [-2, -L * 0.55, -L - 4]) {
      const g = new THREE.Group();
      g.add(this.box(0.12, 6, 0.12, pole, 0, 3, 0), this.box(1.2, 0.08, 0.1, pole, -0.6, 6, 0), this.box(0.5, 0.12, 0.25, lampMat, -1.1, 5.92, 0));
      g.position.set(x0 + 0.3, 0, z);
      this.add(g);
    }
    const rng = new Rng(8);
    const colors = ['#d9a441', '#7aa7c7', '#c9675b', '#9bbf7a', '#e3d3b0', '#b58fc2'];
    const win = new THREE.MeshStandardMaterial({ color: '#ffe3a3', emissive: '#ffc766', emissiveIntensity: 1.2 });
    for (let z = 8; z > -L - 20; z -= rng.range(7, 10)) {
      const w = rng.range(5, 7);
      const h = rng.range(3, 6);
      const house = new THREE.Group();
      house.add(this.box(5, h, w, new THREE.MeshStandardMaterial({ color: rng.pick(colors), roughness: 0.9 }), 0, h / 2, 0));
      house.add(this.box(5.4, 0.2, w + 0.4, new THREE.MeshStandardMaterial({ color: '#5a3a2a' }), 0, h + 0.1, 0));
      for (let k = 0; k < 2; k++) if (rng.next() < 0.75) house.add(this.box(0.05, 0.9, 1, win, 2.52, h * 0.55, (k - 0.5) * w * 0.5));
      house.position.set(x0 - 10, 0, z);
      this.add(house);
    }
  }

  /** mesas e cadeiras de plástico atrás da torcida (como nas fotos dos salões) */
  private furniture(spec: CourtSpec, side: number, tableColors: string[], chairColors: string[]): void {
    const { length: L, width: W } = spec;
    const rng = new Rng(side > 0 ? 11 : 12);
    const x = side * (W / 2 + 2.25);
    for (let z = -2.5; z > -L + 2; z -= rng.range(3.2, 4.6)) {
      const tm = new THREE.MeshStandardMaterial({ color: rng.pick(tableColors), roughness: 0.55 });
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), tm);
      top.position.y = 0.72;
      g.add(top);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        g.add(this.box(0.035, 0.72, 0.035, tm, Math.cos(a) * 0.3, 0.36, Math.sin(a) * 0.3));
      }
      for (let k = 0; k < 3; k++) {
        const cm = new THREE.MeshStandardMaterial({ color: rng.pick(chairColors), roughness: 0.55 });
        const ch = new THREE.Group();
        ch.add(this.box(0.44, 0.04, 0.42, cm, 0, 0.44, 0), this.box(0.44, 0.42, 0.04, cm, 0, 0.66, -0.2));
        for (const [dx, dz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) ch.add(this.box(0.03, 0.44, 0.03, cm, dx, 0.22, dz));
        const a = (k / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
        ch.position.set(Math.cos(a) * 0.68, 0, Math.sin(a) * 0.68);
        ch.rotation.y = -a - Math.PI / 2;
        g.add(ch);
      }
      if (rng.next() < 0.7) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10), new THREE.MeshStandardMaterial({ color: '#4a2a10', roughness: 0.2 }));
        b.position.set(rng.range(-0.15, 0.15), 0.88, rng.range(-0.15, 0.15));
        g.add(b);
      }
      g.position.set(x + rng.range(-0.2, 0.2), 0, z);
      this.add(g);
    }
  }

  /** arquibancada de concreto dentro do ginásio */
  private bleachers(spec: CourtSpec): void {
    const { length: L, width: W } = spec;
    const concrete = new THREE.MeshStandardMaterial({ color: '#b9b4aa', roughness: 0.95 });
    const seat = new THREE.MeshStandardMaterial({ color: '#2f6f9e', roughness: 0.7 });
    for (let k = 0; k < 4; k++) {
      const x = -(W / 2 + 1.5 + k * 0.7);
      this.add(this.box(0.7, 0.45 * (k + 1), L * 0.8, concrete, x, 0.225 * (k + 1), -L / 2));
      this.add(this.box(0.66, 0.05, L * 0.8, seat, x, 0.45 * (k + 1) + 0.025, -L / 2));
    }
  }
}
