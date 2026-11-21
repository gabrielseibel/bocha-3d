// Tipos de cancha (ambiente + piso). Só dados: usados pela física, pela IA
// (Web Worker) e pela renderização.

export type VenueId = 'clube' | 'interior' | 'bar' | 'ginasio' | 'salao';

/** comportamento do piso */
export interface Surface {
  name: string;
  /** multiplica a resistência ao rolamento da bola */
  rollRes: number;
  /** arrasto proporcional à velocidade enquanto rola (1/s) */
  rollDrag: number;
  /** quanto a bola "afunda" e perde velocidade ao cair */
  plow: number;
  /** restituição base no impacto com o piso */
  restitution: number;
}

export const SURFACES = {
  saibro: { name: 'Saibro', rollRes: 1, rollDrag: 0.045, plow: 0.07, restitution: 0.34 },
  terra: { name: 'Terra batida', rollRes: 1.25, rollDrag: 0.06, plow: 0.09, restitution: 0.28 },
  areia: { name: 'Areia fina', rollRes: 1.12, rollDrag: 0.055, plow: 0.085, restitution: 0.3 },
  carpete: { name: 'Carpete sintético', rollRes: 0.62, rollDrag: 0.025, plow: 0.025, restitution: 0.42 },
  cimento: { name: 'Cimento queimado', rollRes: 0.72, rollDrag: 0.03, plow: 0.03, restitution: 0.4 },
} satisfies Record<string, Surface>;

export interface VenueDef {
  id: VenueId;
  name: string;
  tagline: string;
  surface: Surface;
  /** altura livre sob a cobertura (limita a parábola dos tiros) */
  ceiling: number;
}

export const VENUES: VenueDef[] = [
  { id: 'clube', name: 'Sociedade Recreativa', tagline: 'Saibro coberto, estrutura metálica e sede de tijolo', surface: SURFACES.saibro, ceiling: 5.4 },
  { id: 'interior', name: 'Comunidade do Interior', tagline: 'Terra batida, telhado de barro, capela e araucárias', surface: SURFACES.terra, ceiling: 4.2 },
  { id: 'bar', name: 'Bar de Esquina', tagline: 'De noite, areia fina, varal de lâmpadas e mesa de bar', surface: SURFACES.areia, ceiling: 4.4 },
  { id: 'ginasio', name: 'Ginásio do Clube', tagline: 'Carpete cinza, paredes de carpete verde: a bola corre muito', surface: SURFACES.carpete, ceiling: 6.2 },
  { id: 'salao', name: 'Salão da Comunidade', tagline: 'Cimento queimado, ripas brancas e chimarrão no peitoril', surface: SURFACES.cimento, ceiling: 4.6 },
];

export function venueById(id: string): VenueDef {
  return VENUES.find((v) => v.id === id) ?? VENUES[0];
}
