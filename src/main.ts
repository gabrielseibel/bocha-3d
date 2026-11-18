import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import './style.css';
import { Game } from './game/game';
import { loadSettings } from './game/settings';

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const settings = loadSettings();
  let game: Game;
  try {
    game = new Game(canvas, settings);
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
setTimeout(boot, 30);
