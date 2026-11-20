import type { Difficulty } from '../ai/planner';
import type { Team } from '../physics/world';

export type QualitySetting = 'auto' | 'high' | 'medium' | 'low';

export interface Settings {
  mode: 'cpu' | 'pvp';
  difficulty: Difficulty;
  target: number;
  starter: 'random' | Team;
  volume: number;
  muted: boolean;
  quality: QualitySetting;
  guide: 'off' | 'short' | 'full';
  pip: boolean;
  releaseToThrow: boolean;
  bolimMode: 'throw' | 'auto';
  backWallRule: boolean;
  slowMo: boolean;
  alwaysDistances: boolean;
  thrower: boolean;
  courtLength: number;
  courtWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'cpu',
  difficulty: 'medium',
  target: 12,
  starter: 'random',
  volume: 0.8,
  muted: false,
  quality: 'auto',
  guide: 'full',
  pip: true,
  releaseToThrow: true,
  bolimMode: 'throw',
  backWallRule: true,
  slowMo: true,
  alwaysDistances: false,
  thrower: true,
  courtLength: 24,
  courtWidth: 3.6,
};

const KEY = 'bocha3d.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (parsed[k] !== undefined && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = parsed[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* modo privado / armazenamento bloqueado: segue sem salvar */
  }
}
