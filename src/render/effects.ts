import * as THREE from 'three';
import { craterTexture } from './textures';

const MAX_DUST = 420;

/** Poeira de saibro levantada nos impactos. */
export class Dust {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_DUST * 3);
  private readonly vel = new Float32Array(MAX_DUST * 3);
  private readonly life = new Float32Array(MAX_DUST);
  private readonly maxLife = new Float32Array(MAX_DUST);
  private readonly size = new Float32Array(MAX_DUST);
  private readonly alpha = new Float32Array(MAX_DUST);
  private next = 0;
  private readonly geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { color: { value: new THREE.Color('#d9bf95') }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float a = vA * smoothstep(0.25, 0.0, r);
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setViewportHeight(h: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.9;
  }

  /** nuvem de poeira: intensidade ~ velocidade do impacto (m/s) */
  burst(x: number, z: number, intensity: number, vx = 0, vz = 0, y = 0.02): void {
    const n = Math.min(60, Math.round(4 + intensity * 5));
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_DUST;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.25 + Math.random() * 0.7) * (0.35 + intensity * 0.12);
      this.pos[i * 3] = x + Math.cos(a) * 0.04;
      this.pos[i * 3 + 1] = y + Math.random() * 0.03;
      this.pos[i * 3 + 2] = z + Math.sin(a) * 0.04;
      this.vel[i * 3] = Math.cos(a) * sp + vx * 0.12;
      this.vel[i * 3 + 1] = (0.3 + Math.random() * 0.9) * (0.4 + intensity * 0.1);
      this.vel[i * 3 + 2] = Math.sin(a) * sp + vz * 0.12;
      this.maxLife[i] = this.life[i] = 0.6 + Math.random() * 0.9;
      this.size[i] = 0.035 + Math.random() * 0.05 + intensity * 0.006;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_DUST; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.exp(-2.6 * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - 0.6 * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.005, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.max(0, t) * 0.55;
      this.size[i] += dt * 0.05;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

const MAX_MARKS = 64;

/** Marcas (crateras e arrastos) que as bolas deixam no saibro durante a rodada. */
export class Marks {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: craterTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_MARKS);
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  add(x: number, z: number, size: number, vx: number, vz: number): void {
    const i = this.count % MAX_MARKS;
    const sp = Math.hypot(vx, vz);
    const stretch = 1 + Math.min(1.6, sp * 0.18);
    const ang = Math.atan2(vx, vz);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    this.m.compose(new THREE.Vector3(x + vx * 0.012, 0.0015, z + vz * 0.012), this.q, new THREE.Vector3(size, 1, size * stretch));
    this.mesh.setMatrixAt(i, this.m);
    this.count++;
    this.mesh.count = Math.min(this.count, MAX_MARKS);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }
}

const TRAIL = 120;

/** Rastro discreto atrás da bola em voo (ajuda a ler a parábola, principalmente no celular). */
export class Trail {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(TRAIL * 3);
  private readonly age = new Float32Array(TRAIL).fill(99);
  private readonly size = new Float32Array(TRAIL);
  private readonly alpha = new Float32Array(TRAIL);
  private head = 0;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color('#ffffff') }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(2.0, size * scale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard;
          gl_FragColor = vec4(color, vA * smoothstep(0.25, 0.02, r));
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewportHeight(h: number): void {
    this.mat.uniforms.scale.value = h * 0.9;
  }

  setColor(c: string): void {
    this.mat.uniforms.color.value.set(c);
  }

  push(x: number, y: number, z: number, r: number): void {
    const i = this.head;
    this.head = (this.head + 1) % TRAIL;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.age[i] = 0;
    this.size[i] = r * 1.6;
  }

  update(dt: number): void {
    for (let i = 0; i < TRAIL; i++) {
      this.age[i] += dt;
      const t = this.age[i] / 0.4;
      this.alpha[i] = t >= 1 ? 0 : (1 - t) * (1 - t) * 0.2;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(99);
  }
}
