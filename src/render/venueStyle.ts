import type { VenueId } from '../game/venues';

export type LightPreset = 'day' | 'afternoon' | 'night' | 'indoor';

/** Aparência de cada cancha (a física fica em game/venues.ts). */
export interface VenueStyle {
  id: VenueId;
  floor: { kind: 'clay' | 'carpet' | 'concrete'; color: [number, number, number] };
  /** tabela (tábua junto ao piso) */
  board: string;
  wall: { kind: 'concrete' | 'wood' | 'painted' | 'carpet' | 'slats'; color: string };
  cap: { kind: 'wood' | 'concrete'; color: string };
  walkway: string;
  roof: 'steel' | 'tiles' | 'bulbs' | 'indoor' | 'hall';
  light: LightPreset;
  dust: string;
  /** o piso guarda marca das quedas? (carpete não) */
  marks: boolean;
  /** fração da torcida */
  crowd: number;
  /** nome na placa do placar */
  plaque: string;
  /** placar eletrônico ou o quadro de números (04 08 12…) */
  scoreboard: 'led' | 'numbers';
  /** linhas pintadas atravessando a cancha (cor e espaçamento em m) */
  lines: { color: string; every: number } | null;
  /** fundo da cancha escuro com faixa (como nos salões de carpete) */
  darkBack: boolean;
}

export const VENUE_STYLES: Record<VenueId, VenueStyle> = {
  clube: {
    id: 'clube',
    floor: { kind: 'clay', color: [201, 163, 112] },
    board: '#2d5f97',
    wall: { kind: 'concrete', color: '#f2f0ea' },
    cap: { kind: 'wood', color: '#8d6238' },
    walkway: '#c9c6bd',
    roof: 'steel',
    light: 'day',
    dust: '#d9bf95',
    marks: true,
    crowd: 1,
    plaque: 'SOCIEDADE RECREATIVA',
    scoreboard: 'led',
    lines: null,
    darkBack: false,
  },
  interior: {
    id: 'interior',
    floor: { kind: 'clay', color: [178, 114, 76] },
    board: '#7d5b3b',
    wall: { kind: 'wood', color: '#8f6c49' },
    cap: { kind: 'wood', color: '#6b4a2e' },
    walkway: '#9b8c74',
    roof: 'tiles',
    light: 'afternoon',
    dust: '#c99169',
    marks: true,
    crowd: 0.6,
    plaque: 'CAPELA SÃO JOÃO',
    scoreboard: 'numbers',
    lines: null,
    darkBack: false,
  },
  bar: {
    id: 'bar',
    floor: { kind: 'clay', color: [214, 197, 162] },
    board: '#2f7a4a',
    wall: { kind: 'painted', color: '#e9cf62' },
    cap: { kind: 'concrete', color: '#c4beb2' },
    walkway: '#7f7b74',
    roof: 'bulbs',
    light: 'night',
    dust: '#e6dabf',
    marks: true,
    crowd: 0.7,
    plaque: 'BAR DO ZÉ',
    scoreboard: 'numbers',
    lines: { color: '#fafafa', every: 6 },
    darkBack: false,
  },
  ginasio: {
    id: 'ginasio',
    floor: { kind: 'carpet', color: [74, 78, 84] },
    board: '#c62828',
    scoreboard: 'led',
    wall: { kind: 'carpet', color: '#2f8a4c' },
    cap: { kind: 'concrete', color: '#c9ced3' },
    walkway: '#a7aeb5',
    roof: 'indoor',
    light: 'indoor',
    dust: '#8a8f96',
    marks: false,
    crowd: 1,
    plaque: 'GINÁSIO MUNICIPAL',
    lines: { color: '#e9d64a', every: 2 },
    darkBack: true,
  },
  salao: {
    id: 'salao',
    floor: { kind: 'concrete', color: [206, 204, 197] },
    board: '#d9d3c4',
    scoreboard: 'numbers',
    wall: { kind: 'slats', color: '#f1efe8' },
    cap: { kind: 'wood', color: '#e9e4d6' },
    walkway: '#b9ad98',
    roof: 'hall',
    light: 'indoor',
    dust: '#d8d6cf',
    marks: false,
    crowd: 1.1,
    plaque: 'SALÃO DA COMUNIDADE',
    lines: { color: '#fafafa', every: 4 },
    darkBack: false,
  },
};
