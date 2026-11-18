// Constantes físicas e dimensões padrão da cancha.
// Sistema de coordenadas (o mesmo da física e do Three.js):
//   x = lateral (+x à direita de quem arremessa), y = para cima,
//   z = ao longo da cancha. O arremessador fica perto de z = 0 e a
//   cancha se estende para -z até o fundo em z = -comprimento.

export const GRAVITY = 9.81;
/** Passo fixo da física (s). 480 Hz evita que a bola "atravesse" o bolim mesmo a 15 m/s. */
export const PHYS_DT = 1 / 480;

export const BALL = {
  /** raio (m) — bola de 107 mm */
  r: 0.0535,
  /** massa (kg) */
  m: 0.92,
  /** coeficiente de resistência ao rolamento no saibro */
  rollRes: 0.072,
};

export const BOLIM = {
  r: 0.024,
  m: 0.09,
  rollRes: 0.1,
};

export const GROUND = {
  /** restituição base do saibro; cai com a velocidade de impacto (o barro "absorve") */
  restitution: 0.34,
  restitutionK: 0.12,
  /** abaixo desta velocidade vertical a bola não quica mais, passa a rolar */
  bounceMin: 0.3,
  /** fração da velocidade tangencial perdida por m/s de impacto vertical (bola afunda no saibro) */
  plow: 0.07,
  plowMax: 0.78,
  /** quando a bola já está no chão e é empurrada para baixo por outra (tiro), o efeito é menor */
  plowGrounded: 0.22,
  /** atrito de Coulomb durante o impacto */
  muImpact: 0.42,
  /** atrito de deslizamento (antes da bola entrar em rolamento puro) */
  muSlide: 0.3,
  /** arrasto proporcional à velocidade enquanto rola (1/s) — saibro fofo */
  rollDrag: 0.045,
  /** velocidade abaixo da qual a bola é considerada parada */
  restSpeed: 0.012,
};

export const WALL = {
  restitutionSide: 0.5,
  restitutionEnd: 0.32,
  /** fração da velocidade tangencial perdida ao bater na tabela */
  friction: 0.12,
};

export const CONTACT = {
  /** bolas de resina: choque bem elástico ("toc") */
  ballBall: 0.84,
  ballBolim: 0.78,
  /** penetração tolerada antes da correção de posição (m) */
  slop: 0.0003,
};

export const AIR = { rho: 1.2, cd: 0.47 };

export interface CourtSpec {
  /** comprimento interno (m) */
  length: number;
  /** largura interna (m) */
  width: number;
  /** distância da tabela de trás até a linha de arremesso (m) */
  foulLine: number;
  /** o bolim precisa parar além desta distância (m), medida da tabela de trás */
  bolimMin: number;
  /** ... e antes desta (m) */
  bolimMax: number;
  /** altura das laterais (m) */
  sideWallHeight: number;
  /** altura da tabela do fundo (m) */
  endWallHeight: number;
  /** altura livre sob a estrutura do telhado (m) — limita a parábola */
  ceiling: number;
}

export function makeCourt(length = 24, width = 3.6): CourtSpec {
  return {
    length,
    width,
    foulLine: 2,
    bolimMin: Math.round(length * 0.5 * 10) / 10,
    bolimMax: length - 2,
    sideWallHeight: 0.95,
    endWallHeight: 1.2,
    ceiling: 5.4,
  };
}

export const DEFAULT_COURT = makeCourt();

/** Limites da mira */
export const AIM = {
  yawMax: 14, // graus para cada lado
  arcMin: 8, // graus
  arcMax: 62,
  lateralMargin: 0.3, // distância mínima da tabela lateral (m)
  minSpeed: 2.2, // m/s com força 0
};

export const BALLS_PER_TEAM = 4;
