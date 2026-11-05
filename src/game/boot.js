import { Engine } from '../core/Engine.js';
import { settings } from '../core/Settings.js';
import { Game } from './Game.js';
import { Menus } from '../ui/Menus.js';
import { loadSave } from '../core/Save.js';
import facts from '../data/facts.json';

export async function boot(params) {
  const menus = new Menus(null);
  menus.setLoading(0.05, facts[Math.floor(Math.random() * facts.length)]);
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) {
    menus.setLoading(0, 'This game needs WebGL 2. Please use a recent version of Chrome, Edge, Firefox or Safari.');
    return;
  }
  await new Promise((r) => setTimeout(r, 30));
  const quality = params.get('q') || settings.quality();
  const engine = new Engine(document.getElementById('app'), { quality, resolutionScale: settings.get('resolutionScale'), fov: settings.get('fov') });
  menus.setLoading(0.6);
  const game = new Game(engine, params);
  menus.game = game;
  game.menus = menus;
  menus.setLoading(1);
  const startStage = params.has('stage') ? Number(params.get('stage')) : null;
  if (startStage !== null) {
    await game.goToStage(startStage, { transition: 'cut' });
    menus.hideLoading();
    window.__ready = true;
    return;
  }
  menus.hideLoading();
  game.state = 'title';
  const mobile = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  const save = loadSave();
  const choice = await menus.showTitle({ canContinue: !!save && save.stage > 0, mobile });
  if (choice === 'continue' && save) {
    game.save = save;
    await game.goToStage(save.stage);
  } else {
    await game.goToStage(0);
  }
  game.input.requestLock();
}
