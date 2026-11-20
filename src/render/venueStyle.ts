import type { VenueId } from '../game/venues';

export type LightPreset = 'day' | 'afternoon' | 'night' | 'indoor';

/** Aparência de cada cancha (a física fica em game/venues.ts). */
export interface VenueStyle {
  id: VenueId;
  floor: { kind: 'clay' | 'carpet'; color: [number, number, number] };
  /** tabela (tábua junto ao piso) */
  board: string;
  wall: { kind: 'concrete' | 'wood' | 'painted'; color: string };
  cap: { kind: 'wood' | 'concrete'; color: string };
  walkway: string;
  roof: 'steel' | 'tiles' | 'bulbs' | 'indoor';
  light: LightPreset;
  dust: string;
  /** o piso guarda marca das quedas? (carpete não) */
  marks: boolean;
  /** fração da torcida */
  crowd: number;
  /** nome na placa do placar */
  plaque: string;
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
  },
  ginasio: {
    id: 'ginasio',
    floor: { kind: 'carpet', color: [42, 114, 84] },
    board: '#b07a40',
    wall: { kind: 'wood', color: '#c08d52' },
    cap: { kind: 'wood', color: '#7a4d22' },
    walkway: '#a7aeb5',
    roof: 'indoor',
    light: 'indoor',
    dust: '#6f9a80',
    marks: false,
    crowd: 1,
    plaque: 'GINÁSIO MUNICIPAL',
  },
};
