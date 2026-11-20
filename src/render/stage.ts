import * as THREE from 'three';
import type { LightPreset } from './venueStyle';

export type Quality = 'high' | 'medium' | 'low';

export interface PipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Renderer, cena, luzes e mapa de ambiente. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
  readonly pipCamera = new THREE.PerspectiveCamera(36, 4 / 3, 0.05, 80);
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  quality: Quality;
  width = 1;
  height = 1;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color('#cfe2f2');
    this.scene.fog = new THREE.Fog('#d6e4ee', 45, 190);

    this.hemi = new THREE.HemisphereLight('#eaf4ff', '#8c7656', 1.15);
    this.scene.add(this.hemi);

    // "sol" quase vertical: a sombra fica logo abaixo da bola — ótima pista de altura durante o voo
    this.sun = new THREE.DirectionalLight('#fff4e2', 2.1);
    this.sun.position.set(-3.5, 16, -6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // camada 1: só a câmera principal; camada 2: só a janela do bolim
    this.camera.layers.enable(1);
    this.pipCamera.layers.enable(2);
    this.buildEnvironmentMap();
    this.applyQuality();
  }

  private readonly nightLights = new THREE.Group();

  /** iluminação de cada ambiente */
  setLighting(preset: LightPreset, lamps: THREE.Vector3[] = []): void {
    const P = {
      day: { bg: '#cfe2f2', fog: '#d6e4ee', near: 45, far: 190, sky: '#eaf4ff', ground: '#8c7656', hemi: 1.15, sun: '#fff4e2', sunI: 2.1, exp: 1.05, env: 0.55 },
      afternoon: { bg: '#efd9b6', fog: '#ecdcc2', near: 40, far: 170, sky: '#fff0d6', ground: '#8a6a48', hemi: 1.0, sun: '#ffd49a', sunI: 2.35, exp: 1.0, env: 0.5 },
      night: { bg: '#0a1222', fog: '#0a1222', near: 22, far: 95, sky: '#53689a', ground: '#2c2218', hemi: 0.5, sun: '#ffcf8a', sunI: 1.45, exp: 1.15, env: 0.2 },
      indoor: { bg: '#30353b', fog: '#30353b', near: 70, far: 220, sky: '#ffffff', ground: '#8a8074', hemi: 1.0, sun: '#fffaf0', sunI: 1.75, exp: 1.0, env: 0.45 },
    }[preset];
    (this.scene.background as THREE.Color).set(P.bg);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(P.fog);
    fog.near = P.near;
    fog.far = P.far;
    this.hemi.color.set(P.sky);
    this.hemi.groundColor.set(P.ground);
    this.hemi.intensity = P.hemi;
    this.sun.color.set(P.sun);
    this.sun.intensity = P.sunI;
    this.renderer.toneMappingExposure = P.exp;
    this.scene.environmentIntensity = P.env;
    // à noite, algumas luzes pontuais quentes das lâmpadas (poucas, por desempenho)
    this.nightLights.clear();
    if (preset === 'night' && lamps.length) {
      const step = Math.max(1, Math.floor(lamps.length / 4));
      for (let i = 0; i < lamps.length && this.nightLights.children.length < 4; i += step) {
        const l = new THREE.PointLight('#ffc879', 9, 11, 1.6);
        l.position.copy(lamps[i]);
        this.nightLights.add(l);
      }
    }
    if (!this.nightLights.parent) this.scene.add(this.nightLights);
  }

  /** enquadra a sombra do "sol" na cancha */
  fitShadow(length: number, width: number): void {
    const cam = this.sun.shadow.camera;
    const cz = -length / 2;
    this.sun.target.position.set(0, 0, cz);
    this.sun.position.set(-2.5, 16, cz + 2.5);
    // "up" ao longo da cancha: o eixo longo do frustum ortográfico acompanha o eixo z
    cam.up.set(0, 0, -1);
    cam.left = -(width / 2 + 1.4);
    cam.right = width / 2 + 1.4;
    cam.top = length / 2 + 2;
    cam.bottom = -(length / 2 + 2);
    cam.near = 2;
    cam.far = 40;
    cam.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
  }

  private applyQuality(): void {
    const dpr = window.devicePixelRatio || 1;
    const ratio = this.quality === 'high' ? Math.min(dpr, 2) : this.quality === 'medium' ? Math.min(dpr, 1.5) : 1;
    this.renderer.setPixelRatio(ratio);
    const size = this.quality === 'high' ? 2048 : this.quality === 'medium' ? 1536 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.resize();
  }

  /** ambiente para reflexos discretos nas bolas: céu claro, piso de saibro, luminárias */
  private buildEnvironmentMap(): void {
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(20, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vp;
        void main(){
          float h = normalize(vp).y;
          vec3 sky = mix(vec3(0.86,0.91,0.96), vec3(0.45,0.62,0.85), clamp(h*1.4,0.0,1.0));
          vec3 ground = mix(vec3(0.62,0.5,0.36), vec3(0.42,0.5,0.32), clamp(-h*2.0,0.0,1.0));
          vec3 c = h > 0.0 ? sky : ground;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    envScene.add(new THREE.Mesh(geo, mat));
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }));
    lamp.position.set(0, 9, 0);
    envScene.add(lamp);
    const lamp2 = lamp.clone();
    lamp2.position.set(5, 7, -6);
    envScene.add(lamp2);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    geo.dispose();
    mat.dispose();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(pip: PipRect | null): void {
    const r = this.renderer;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.render(this.scene, this.camera);
    if (pip && pip.w > 20 && pip.h > 20) {
      const y = this.height - pip.y - pip.h;
      r.setScissorTest(true);
      r.setScissor(pip.x, y, pip.w, pip.h);
      r.setViewport(pip.x, y, pip.w, pip.h);
      this.pipCamera.aspect = pip.w / pip.h;
      this.pipCamera.updateProjectionMatrix();
      r.render(this.scene, this.pipCamera);
      r.setScissorTest(false);
    }
  }
}
