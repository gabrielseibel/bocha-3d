import * as THREE from 'three';
import { Rng } from '../util/rng';

// Texturas 100% procedurais (canvas 2D): carregamento instantâneo, nada para baixar.

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** ruído de valor 2D periódico (para texturas sem emenda) */
function makeNoise(seed: number, period: number): (x: number, y: number) => number {
  const rng = new Rng(seed);
  const table = new Float32Array(period * period);
  for (let i = 0; i < table.length; i++) table[i] = rng.next();
  const at = (ix: number, iy: number) => table[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)];
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** fbm periódico: u,v em [0,1) */
function fbm(seed: number, base: number, octaves: number): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => makeNoise(seed + i * 101, base << i));
  return (u: number, v: number) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const p = base << i;
      sum += layers[i](u * p, v * p) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** gera normal map a partir de um mapa de altura (Sobel) */
function normalFromHeight(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface ClayTextures {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
}

/** saibro compactado: bege-alaranjado, grãos, pedriscos e marcas de rastelo */
/** saibro/terra/areia: base RGB do piso */
export function clayTextures(size: number, base: [number, number, number] = [201, 163, 112]): ClayTextures {
  const rng = new Rng(7);
  const n = fbm(11, 4, 5);
  const fine = fbm(23, 32, 2);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const a = n(u, v);
      const f = fine(u, v);
      const k = 0.9 + 0.2 * a + 0.06 * (f - 0.5);
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0] * k);
      img.data[i + 1] = Math.min(255, base[1] * k);
      img.data[i + 2] = Math.min(255, base[2] * k * (0.97 + 0.06 * a));
      img.data[i + 3] = 255;
      height[y * size + x] = f * 0.6 + a * 0.4;
    }
  }
  ctx.putImageData(img, 0, 0);
  // marcas finas de rastelo/vassoura ao longo da cancha
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, size);
    ctx.strokeStyle = rng.next() < 0.5 ? '#8a6a44' : '#f1dcb6';
    ctx.lineWidth = rng.range(0.6, 1.6);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + rng.range(-6, 6), size * 0.33, x + rng.range(-6, 6), size * 0.66, x, size);
    ctx.stroke();
  }
  // grãos de areia
  const scale = size / 512;
  for (let i = 0; i < 11000 * scale * scale; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(0.4, 1.3) * scale;
    const t = rng.next();
    ctx.globalAlpha = rng.range(0.18, 0.45);
    ctx.fillStyle = t < 0.45 ? '#7d5b3a' : t < 0.8 ? '#f3e2c2' : '#a7623b';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    const hi = Math.floor(y) * size + Math.floor(x);
    if (hi >= 0 && hi < height.length) height[hi] += t < 0.45 ? -0.25 : 0.35;
  }
  // pedriscos
  for (let i = 0; i < 160 * scale * scale; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(1.2, 2.8) * scale;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = rng.pick(['#b89870', '#9c7b55', '#d8c09a', '#8f6a4a']);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.6, 1), rng.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#fff4dd';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const hx = Math.floor(x + dx);
        const hy = Math.floor(y + dy);
        if (hx >= 0 && hy >= 0 && hx < size && hy < size) height[hy * size + hx] += 0.5;
      }
  }
  ctx.globalAlpha = 1;
  const normal = normalFromHeight(height, size, 2.2);
  return { map: toTexture(c, true, true), normal: toTexture(normal, false, true) };
}

/** carpete sintético (como nos ginásios de bocha): fibras verdes curtas */
export function carpetTextures(size: number, base: [number, number, number] = [44, 112, 84]): ClayTextures {
  const rng = new Rng(19);
  const n = fbm(37, 8, 3);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = n(x / size, y / size);
      const fiber = rng.next();
      const k = 0.86 + 0.14 * a + 0.12 * (fiber - 0.5);
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0] * k);
      img.data[i + 1] = Math.min(255, base[1] * k);
      img.data[i + 2] = Math.min(255, base[2] * k);
      img.data[i + 3] = 255;
      height[y * size + x] = fiber * 0.7 + a * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0);
  // marcas de "pelo" do carpete penteado ao longo da cancha
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, size);
    ctx.strokeStyle = rng.next() < 0.5 ? '#0d3a28' : '#9fe0b8';
    ctx.lineWidth = rng.range(0.5, 1.4);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + rng.range(-3, 3), size);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const normal = normalFromHeight(height, size, 1.1);
  return { map: toTexture(c, true, true), normal: toTexture(normal, false, true) };
}

/** cimento queimado: liso, manchado, com marcas da desempenadeira */
export function concreteFloorTextures(size: number, base: [number, number, number] = [206, 204, 197]): ClayTextures {
  const rng = new Rng(61);
  const n = fbm(71, 4, 5);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = n(x / size, y / size);
      const k = 0.9 + 0.16 * a;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0] * k);
      img.data[i + 1] = Math.min(255, base[1] * k);
      img.data[i + 2] = Math.min(255, base[2] * k);
      img.data[i + 3] = 255;
      height[y * size + x] = a * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = rng.next() < 0.5 ? '#6f6c66' : '#ffffff';
    ctx.lineWidth = rng.range(2, 6);
    ctx.beginPath();
    ctx.arc(rng.range(0, size), rng.range(0, size), rng.range(size * 0.1, size * 0.35), rng.range(0, 3), rng.range(3, 6));
    ctx.stroke();
  }
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = rng.next() < 0.5 ? '#8c8880' : '#f4f2ec';
    ctx.fillRect(rng.range(0, size), rng.range(0, size), 1, 1);
  }
  ctx.globalAlpha = 1;
  const normal = normalFromHeight(height, size, 0.6);
  return { map: toTexture(c, true, true), normal: toTexture(normal, false, true) };
}

/** variação de grande escala da cancha inteira (sem repetição): cantos mais escuros, faixa central batida */
export function clayMacroTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 512;
  const n = fbm(5, 3, 4);
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const edge = Math.min(u, 1 - u);
      let k = 0.5 + 0.09 * (n(u * 0.25, v) - 0.5) * 2;
      k -= 0.075 * Math.max(0, 1 - edge / 0.12); // terra acumulada junto às tabelas
      k += 0.025 * Math.exp(-Math.pow((u - 0.5) / 0.18, 2)); // faixa central mais batida
      k -= 0.04 * Math.max(0, 1 - v / 0.06); // área de arremesso pisoteada
      const i = (y * w + x) * 4;
      const g = Math.max(0, Math.min(255, k * 255));
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false, false);
}

export function concreteTexture(): THREE.CanvasTexture {
  const size = 256;
  const n = fbm(31, 4, 5);
  const rng = new Rng(3);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const k = 0.86 + 0.18 * n(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = 222 * k;
      img.data[i + 1] = 222 * k;
      img.data[i + 2] = 216 * k;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = rng.range(0.05, 0.18);
    ctx.fillStyle = rng.next() < 0.5 ? '#6f6f6a' : '#ffffff';
    ctx.fillRect(rng.range(0, size), rng.range(0, size), 1.2, 1.2);
  }
  ctx.globalAlpha = 1;
  return toTexture(c, true, true);
}

export function woodTexture(base = '#9a6a3c'): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const rng = new Rng(17);
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y = rng.range(0, h);
    ctx.strokeStyle = rng.next() < 0.6 ? 'rgba(60,35,15,0.25)' : 'rgba(255,220,170,0.12)';
    ctx.lineWidth = rng.range(0.5, 2.2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * rng.range(0.5, 3));
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const x = rng.range(20, w - 20);
    const y = rng.range(10, h - 10);
    ctx.fillStyle = 'rgba(70,40,18,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(5, 10), rng.range(2, 4), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, true, true);
}

export function grassTexture(): THREE.CanvasTexture {
  const size = 256;
  const n = fbm(41, 4, 5);
  const rng = new Rng(9);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = n(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = 70 + 40 * a;
      img.data[i + 1] = 112 + 50 * a;
      img.data[i + 2] = 48 + 20 * a;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 2500; i++) {
    ctx.strokeStyle = rng.next() < 0.5 ? 'rgba(40,80,30,0.35)' : 'rgba(160,190,90,0.3)';
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-1.5, 1.5), y - rng.range(2, 5));
    ctx.stroke();
  }
  return toTexture(c, true, true);
}

export function brickTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const rng = new Rng(13);
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#cfc2b0';
  ctx.fillRect(0, 0, w, h);
  const bw = 32;
  const bh = 14;
  for (let row = 0; row * bh < h; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < w + bw; x += bw) {
      const r = 150 + rng.range(-25, 20);
      ctx.fillStyle = `rgb(${r},${r * 0.45 + rng.range(0, 15)},${r * 0.3})`;
      ctx.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
  return toTexture(c, true, true);
}

/** telha de barro (capa e canal) */
export function tileTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 64;
  const rng = new Rng(29);
  const [c, ctx] = canvas(w, h);
  for (let x = 0; x < w; x++) {
    const k = 0.7 + 0.3 * Math.sin((x / w) * Math.PI);
    ctx.fillStyle = `rgb(${Math.round(168 * k)},${Math.round(78 * k)},${Math.round(46 * k)})`;
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.fillStyle = 'rgba(40,15,8,0.35)';
  ctx.fillRect(0, h - 5, w, 5);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rng.next() < 0.5 ? 'rgba(90,40,20,0.15)' : 'rgba(230,170,120,0.15)';
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 6), rng.range(1, 3));
  }
  return toTexture(c, true, true);
}

export function roofTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 128;
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 8; i++) {
    g.addColorStop(i / 8, i % 2 ? '#aab1b6' : '#d9dee2');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return toTexture(c, true, true);
}

/** bolas: base de resina com sulcos em anéis concêntricos (mostram a rotação) */
export function ballTexture(base: string, groove: string, light: string, rings: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const rng = new Rng(base.length * 31 + rings);
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // resina marmorizada: veios ondulados claros e escuros (como as bolas das fotos)
  const marble = fbm(base.length * 7 + rings, 4, 4);
  const img = ctx.getImageData(0, 0, w, h);
  const bc = new THREE.Color(base);
  const lc = new THREE.Color(light);
  const gc = new THREE.Color(groove);
  const tmp = new THREE.Color();
  const srgb = { r: 0, g: 0, b: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = marble(x / w, y / h);
      const vein = Math.sin((x / w) * 12 + m * 14 + (y / h) * 5);
      tmp.copy(bc);
      if (vein > 0.55) tmp.lerp(lc, (vein - 0.55) * 1.6);
      else if (vein < -0.7) tmp.lerp(gc, (-0.7 - vein) * 1.2);
      const i = (y * w + x) * 4;
      tmp.getRGB(srgb, THREE.SRGBColorSpace);
      img.data[i] = srgb.r * 255;
      img.data[i + 1] = srgb.g * 255;
      img.data[i + 2] = srgb.b * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // veios suaves da resina
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = rng.next() < 0.5 ? light : groove;
    ctx.beginPath();
    ctx.ellipse(rng.range(0, w), rng.range(0, h), rng.range(30, 90), rng.range(8, 26), rng.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // anéis concêntricos em dois polos opostos (sobre o equador)
  const drawCircle = (lon0: number, rad: number, color: string, width: number) => {
    const cx = Math.cos(lon0);
    const cz = Math.sin(lon0);
    // base ortonormal: e1 = cima (y), e2 = tangente horizontal
    const pts: [number, number][] = [];
    for (let k = 0; k <= 160; k++) {
      const t = (k / 160) * Math.PI * 2;
      const x = Math.cos(rad) * cx + Math.sin(rad) * Math.sin(t) * -cz;
      const y = Math.sin(rad) * Math.cos(t);
      const z = Math.cos(rad) * cz + Math.sin(rad) * Math.sin(t) * cx;
      const lon = Math.atan2(z, x);
      const lat = Math.asin(Math.max(-1, Math.min(1, y)));
      pts.push([((lon / (Math.PI * 2) + 1) % 1) * w, (0.5 - lat / Math.PI) * h]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let k = 0; k < pts.length; k++) {
      const [x, y] = pts[k];
      if (k === 0 || Math.abs(x - pts[k - 1][0]) > w / 2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  for (const lon of [0, Math.PI]) {
    for (let r = 0; r < rings; r++) {
      const rad = 0.28 + r * 0.17;
      drawCircle(lon, rad + 0.012, light, 2);
      drawCircle(lon, rad, groove, 3.2);
    }
  }
  // faixa equatorial fina
  ctx.strokeStyle = groove;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h / 2 + h * 0.12);
  ctx.lineTo(w, h / 2 + h * 0.12);
  ctx.stroke();
  ctx.globalAlpha = 1;
  return toTexture(c, true, false);
}

export function bolimTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#f7f4ea';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c9c2ae';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.fillStyle = '#d0c7b0';
  for (const x of [w * 0.25, w * 0.75]) {
    ctx.beginPath();
    ctx.arc(x, h / 2, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, true, false);
}

export function radialTexture(stops: [number, string][], size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, true, false);
}

/** marca de impacto no saibro: cratera mais escura com borda clara levantada */
export function craterTexture(): THREE.CanvasTexture {
  const size = 128;
  const rng = new Rng(77);
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(92,62,32,0.55)');
  g.addColorStop(0.45, 'rgba(110,78,44,0.42)');
  g.addColorStop(0.62, 'rgba(250,228,190,0.38)');
  g.addColorStop(0.8, 'rgba(230,200,150,0.12)');
  g.addColorStop(1, 'rgba(230,200,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(size * 0.32, size * 0.46);
    ctx.fillStyle = `rgba(245,225,190,${rng.range(0.15, 0.4)})`;
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, rng.range(1, 2.5), 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, true, false);
}

/** placa de placar pintada (atualizada pelo jogo) */
export function plaqueCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D, THREE.CanvasTexture] {
  const [c, ctx] = canvas(1024, 256);
  const t = toTexture(c, true, false);
  return [c, ctx, t];
}
