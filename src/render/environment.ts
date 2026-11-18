import * as THREE from 'three';
import type { CourtSpec } from '../config';
import { Rng } from '../util/rng';
import { brickTexture, grassTexture, woodTexture } from './textures';

/** Céu, gramado, morros, árvores e a sede do clube ao fundo. */
export class Environment {
  readonly group = new THREE.Group();
  private readonly dynamic = new THREE.Group();

  constructor(quality: 'high' | 'medium' | 'low') {
    this.group.add(this.dynamic);
    this.buildSky();
    this.buildGround();
    this.buildHills();
    this.treeCount = quality === 'high' ? 80 : quality === 'medium' ? 52 : 30;
  }

  private treeCount: number;

  private buildSky(): void {
    const geo = new THREE.SphereGeometry(320, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vp;
        void main(){
          vec3 d = normalize(vp);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 top = vec3(0.30, 0.55, 0.86);
          vec3 horizon = vec3(0.82, 0.89, 0.94);
          vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
          // nuvens suaves
          float cl = sin(d.x*9.0 + d.z*3.0) * sin(d.z*7.0 - d.x*2.0) * 0.5 + 0.5;
          c = mix(c, vec3(0.97), smoothstep(0.72, 0.95, cl) * smoothstep(0.05, 0.35, h) * 0.55);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    this.group.add(sky);
  }

  private buildGround(): void {
    const tex = grassTexture();
    tex.repeat.set(90, 90);
    const g = new THREE.PlaneGeometry(420, 420);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    m.position.set(0, -0.03, -12);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private buildHills(): void {
    const rng = new Rng(21);
    const geo = new THREE.SphereGeometry(1, 18, 10);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = rng.range(120, 190);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.27 + rng.range(-0.03, 0.03), 0.35, 0.3 + rng.range(-0.05, 0.05)), roughness: 1, flatShading: true });
      const h = new THREE.Mesh(geo, mat);
      h.scale.set(rng.range(40, 80), rng.range(12, 30), rng.range(30, 60));
      h.position.set(Math.cos(a) * r, -4, -12 + Math.sin(a) * r);
      this.group.add(h);
    }
  }

  /** árvores, bancos e sede: posicionados conforme o tamanho da cancha */
  layout(spec: CourtSpec): void {
    for (const c of [...this.dynamic.children]) {
      c.removeFromParent();
      (c as THREE.Mesh).geometry?.dispose();
    }
    const { length: L, width: W } = spec;
    const rng = new Rng(99);
    // árvores
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 1 }), this.treeCount);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), this.treeCount * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let placed = 0;
    let ci = 0;
    let guard = 0;
    while (placed < this.treeCount && guard++ < 4000) {
      const x = rng.range(-70, 70);
      const z = rng.range(-L - 60, 45);
      const insideBuilding = Math.abs(x) < W / 2 + 6 && z > -L - 13 && z < 9;
      if (insideBuilding || Math.hypot(x, z + L / 2) > 85) continue;
      const h = rng.range(3, 7.5);
      m.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(1, h * 0.55, 1));
      trunks.setMatrixAt(placed, m);
      for (let k = 0; k < 2; k++) {
        const s = rng.range(1.4, 2.6) * (h / 5);
        q.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)));
        m.compose(new THREE.Vector3(x + rng.range(-0.6, 0.6), h * 0.55 + s * (0.5 + k * 0.6), z + rng.range(-0.6, 0.6)), q, new THREE.Vector3(s, s * rng.range(0.8, 1.1), s));
        crowns.setMatrixAt(ci, m);
        crowns.setColorAt(ci, col.setHSL(0.25 + rng.range(-0.05, 0.06), rng.range(0.35, 0.55), rng.range(0.22, 0.36)));
        ci++;
      }
      q.identity();
      placed++;
    }
    trunks.count = placed;
    crowns.count = ci;
    crowns.castShadow = false;
    this.dynamic.add(trunks, crowns);

    // sede do clube (tijolo à vista) atrás do fundo da cancha
    const brick = brickTexture();
    brick.repeat.set(5, 2);
    const house = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 5.5), new THREE.MeshStandardMaterial({ map: brick, roughness: 0.95 }));
    walls.position.y = 1.6;
    house.add(walls);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#9b4a2c', roughness: 0.85, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.4), roofMat);
      r.rotation.order = 'YXZ';
      r.rotation.x = -Math.PI / 2 + s * 0.42;
      r.position.set(0, 3.95, s * 1.45);
      house.add(r);
    }
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.06), dark);
    door.position.set(-2.5, 1.05, 2.77);
    house.add(door);
    for (const x of [0.6, 3]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 0.06), new THREE.MeshStandardMaterial({ color: '#43535e', roughness: 0.2, metalness: 0.4 }));
      win.position.set(x, 1.75, 2.77);
      house.add(win);
    }
    house.position.set(1.5, 0, -L - 9.5);
    this.dynamic.add(house);

    // bancos de madeira dos jogadores
    const wood = woodTexture('#7a5230');
    const benchMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 });
    for (const s of [-1, 1]) {
      for (const z of [-3, -L * 0.45]) {
        const bench = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 2), benchMat);
        seat.position.y = 0.45;
        bench.add(seat);
        for (const dz of [-0.85, 0.85]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.45, 0.06), benchMat);
          leg.position.set(0, 0.225, dz);
          bench.add(leg);
        }
        bench.position.set(s * (W / 2 + 2.7), 0, z);
        bench.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        this.dynamic.add(bench);
      }
    }
  }
}
