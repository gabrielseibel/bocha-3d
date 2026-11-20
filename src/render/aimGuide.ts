import * as THREE from 'three';
import { BALL, BOLIM, type CourtSpec } from '../config';
import type { BodyKind } from '../physics/world';
import { predictPath, styleOf, type Aim } from '../physics/shot';

export type GuideMode = 'off' | 'short' | 'full';

const MAX_PTS = 900;

const vert = `attribute float along; attribute float side;
varying float vAlong; varying float vSide;
void main(){ vAlong = along; vSide = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const frag = `uniform vec3 color; uniform float time; uniform float total; uniform float outline; uniform float opacity;
varying float vAlong; varying float vSide;
void main(){
  float edge = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
  float fadeIn = smoothstep(0.0, 0.5, vAlong);
  float fadeOut = 1.0 - smoothstep(total - 0.6, total, vAlong);
  float dash = outline > 0.5 ? 1.0 : 0.62 + 0.38 * step(0.5, fract(vAlong * 2.4 - time * 1.8));
  vec3 c = outline > 0.5 ? vec3(0.04, 0.06, 0.09) : mix(color, vec3(1.0), 0.35 * (1.0 - abs(vSide)) * dash);
  float a = (outline > 0.5 ? 0.55 : 1.0) * edge * fadeIn * fadeOut * dash * opacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

class Ribbon {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private readonly pos = new Float32Array(MAX_PTS * 2 * 3);
  private readonly along = new Float32Array(MAX_PTS * 2);
  private readonly side = new Float32Array(MAX_PTS * 2);
  private readonly geo = new THREE.BufferGeometry();

  constructor(outline: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('along', new THREE.BufferAttribute(this.along, 1));
    this.geo.setAttribute('side', new THREE.BufferAttribute(this.side, 1));
    const idx = new Uint16Array((MAX_PTS - 1) * 6);
    for (let i = 0; i < MAX_PTS - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      uniforms: {
        color: { value: new THREE.Color('#ffffff') },
        time: { value: 0 },
        total: { value: 1 },
        outline: { value: outline ? 1 : 0 },
        opacity: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = outline ? 6 : 7;
  }

  /** pts: x,y,z já na altura de desenho; width em metros */
  set(pts: number[], count: number, width: number, grow: number): number {
    const n = Math.min(count, MAX_PTS);
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3];
      const y = pts[i * 3 + 1];
      const z = pts[i * 3 + 2];
      const ip = Math.max(0, i - 1);
      const inx = Math.min(n - 1, i + 1);
      let dx = pts[inx * 3] - pts[ip * 3];
      let dz = pts[inx * 3 + 2] - pts[ip * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      if (i > 0) dist += Math.hypot(x - pts[ip * 3], y - pts[ip * 3 + 1], z - pts[ip * 3 + 2]);
      // fica mais larga com a distância para continuar visível lá no fundo
      const wd = width + grow * dist;
      const nx = -dz * wd * 0.5;
      const nz = dx * wd * 0.5;
      this.pos.set([x + nx, y, z + nz, x - nx, y, z - nz], i * 6);
      this.along[i * 2] = this.along[i * 2 + 1] = dist;
      this.side[i * 2] = 1;
      this.side[i * 2 + 1] = -1;
    }
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.geo.attributes.position.needsUpdate = true;
    (this.geo.attributes.along as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.side as THREE.BufferAttribute).needsUpdate = true;
    return dist;
  }
}

/**
 * Mira: faixa colorida (com contorno escuro) do caminho previsto inteiro —
 * voo e rolamento — terminando numa bola fantasma onde a bola vai parar.
 * A previsão ignora as outras bolas: o resultado de choques continua sendo habilidade.
 */
export class AimGuide {
  readonly group = new THREE.Group();
  private readonly line = new Ribbon(false);
  private readonly outline = new Ribbon(true);
  /** versão fina para a janela do bolim (zoom) */
  private readonly linePip = new Ribbon(false);
  private readonly outlinePip = new Ribbon(true);
  private readonly ghost: THREE.Mesh;
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly landing: THREE.Mesh;
  private readonly landingMat: THREE.MeshBasicMaterial;
  private readonly pin = new THREE.Group();
  private readonly pinMat: THREE.MeshBasicMaterial;
  private last = '';
  private time = 0;
  private color = new THREE.Color('#4ea1ff');
  private dead = false;
  private readonly draw: number[] = [];

  constructor() {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.ghostMat);
    this.ghost.renderOrder = 8;
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.renderOrder = 8;
    this.landingMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    this.landing = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 36).rotateX(-Math.PI / 2), this.landingMat);
    this.landing.renderOrder = 8;
    // pino flutuando sobre o ponto de parada: visível mesmo lá no fundo da cancha
    this.pinMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const edge = new THREE.MeshBasicMaterial({ color: '#0b1118' });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 20).rotateX(Math.PI).translate(0, 0.1, 0), this.pinMat);
    const coneEdge = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.25, 20).rotateX(Math.PI).translate(0, 0.115, 0), edge);
    coneEdge.material.side = THREE.BackSide;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12).translate(0, 0.24, 0), this.pinMat);
    const headEdge = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12).translate(0, 0.24, 0), edge);
    headEdge.material.side = THREE.BackSide;
    this.pin.add(coneEdge, cone, headEdge, head);
    for (const m of [coneEdge, cone, headEdge, head]) m.layers.set(1);
    this.pin.renderOrder = 9;
    for (const r of [this.line, this.outline]) r.mesh.layers.set(1);
    for (const r of [this.linePip, this.outlinePip]) r.mesh.layers.set(2);
    this.group.add(this.outline.mesh, this.line.mesh, this.outlinePip.mesh, this.linePip.mesh, this.ghost, this.ring, this.landing, this.pin);
  }

  setColor(color: string): void {
    this.color.set(color);
    this.last = '';
  }

  hide(): void {
    this.group.visible = false;
  }

  update(aim: Aim, court: CourtSpec, kind: BodyKind, mode: GuideMode, backWallRule: boolean, dt: number): void {
    this.group.visible = mode !== 'off';
    if (mode === 'off') return;
    this.time += dt;
    this.line.mat.uniforms.time.value = this.time;
    this.linePip.mat.uniforms.time.value = this.time;
    this.pin.position.y = 0.32 + 0.06 * Math.sin(this.time * 3);
    this.pin.rotation.y = this.time * 1.5;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.5);
    this.ringMat.opacity = 0.55 + 0.4 * pulse;
    this.ghostMat.opacity = 0.3 + 0.15 * pulse;
    const key = `${aim.x0.toFixed(4)}|${aim.yaw.toFixed(4)}|${aim.arc.toFixed(3)}|${aim.power.toFixed(4)}|${mode}|${kind}|${court.length}|${court.width}|${backWallRule}`;
    if (key === this.last) return;
    this.last = key;
    const r = kind === 'bolim' ? BOLIM.r : BALL.r;
    const p = predictPath(aim, court, kind, backWallRule);
    const n = p.points.length / 3;
    // desenha rente ao chão na parte rolando; no voo, acompanha a parábola (pela base da bola)
    this.draw.length = 0;
    for (let i = 0; i < n; i++) {
      this.draw.push(p.points[i * 3], Math.max(0.008, p.points[i * 3 + 1] - r + 0.008), p.points[i * 3 + 2]);
    }
    let count = n;
    if (mode === 'short') count = Math.max(4, Math.floor(n * 0.45));
    const total = this.line.set(this.draw, count, kind === 'bolim' ? 0.05 : 0.07, 0.0075);
    this.outline.set(this.draw, count, kind === 'bolim' ? 0.1 : 0.13, 0.0095);
    this.linePip.set(this.draw, count, 0.028, 0);
    this.outlinePip.set(this.draw, count, 0.05, 0);
    for (const r of [this.line, this.outline, this.linePip, this.outlinePip]) r.mat.uniforms.total.value = mode === 'short' ? total : total + 1;
    this.dead = p.dead;
    const c = this.dead ? new THREE.Color('#ff4d4d') : this.color;
    this.line.mat.uniforms.color.value.copy(c);
    this.linePip.mat.uniforms.color.value.copy(c);
    this.pinMat.color.copy(c);
    this.ringMat.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.25);
    this.ghostMat.color.copy(c);
    this.landingMat.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.5);
    const full = mode === 'full';
    this.ghost.visible = full;
    this.ring.visible = full;
    this.ghost.scale.setScalar(r);
    this.ghost.position.set(p.stop.x, r, p.stop.z);
    this.ring.scale.setScalar(Math.max(0.16, r * 2.6));
    this.pin.visible = full;
    const far = Math.hypot(p.stop.x - aim.x0, p.stop.z - p.points[2]);
    this.pin.scale.setScalar(Math.min(3, Math.max(1, far / 6)));
    this.pin.position.x = p.stop.x;
    this.pin.position.z = p.stop.z;
    this.ring.position.set(p.stop.x, 0.01, p.stop.z);
    // marca de queda só faz sentido no tiro (no ponto a bola já sai rente ao chão)
    this.landing.visible = full && !!p.landing && styleOf(aim.arc) === 'tiro';
    if (p.landing) this.landing.position.set(p.landing.x, 0.01, p.landing.z);
  }

  /** a previsão atual termina com a bola anulada (bateria no fundo) */
  get predictsDead(): boolean {
    return this.dead;
  }
}
