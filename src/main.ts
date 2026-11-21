import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import './style.css';
import { Game } from './game/game';
import { loadSettings } from './game/settings';
import { CharacterKit } from './render/characters';

async function boot(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const settings = loadSettings();
  const text = document.querySelector('.loading-text');
  if (text) text.textContent = 'Chamando a turma da bocha…';
  let kit: CharacterKit | null = null;
  try {
    kit = await CharacterKit.load(`${import.meta.env.BASE_URL}models/people.glb`);
  } catch (err) {
    console.warn('personagens não carregaram; usando bonecos simples', err);
  }
  if (text) text.textContent = 'Preparando a cancha…';
  await new Promise((r) => setTimeout(r, 20));
  let game: Game;
  try {
    game = new Game(canvas, settings, kit);
  } catch (err) {
    console.error(err);
    const t = document.querySelector('.loading-text');
    if (t) t.textContent = 'Não foi possível iniciar o 3D neste navegador (WebGL indisponível).';
    return;
  }
  game.start();
  // a placa do placar 3D é desenhada em canvas: redesenha quando as fontes carregarem
  void document.fonts?.ready.then(() => game.refreshPlaque());
  (window as unknown as { __bocha: unknown }).__bocha = game.debugApi();
}

// dá tempo da tela de carregamento aparecer antes de gerar as texturas
setTimeout(() => void boot(), 30);
