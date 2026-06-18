// Client entrypoint: wires the login UI, the network layer, the Pixi renderer,
// and the per-frame update loop (camera + entity interpolation + fog + minimap
// + HUD).
import { MAP_PX } from '../../shared/constants.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { ClientState } from './state.js';
import { Net } from './net.js';
import { GameRenderer } from './render/app.js';
import { loadAssets } from './render/assets.js';
import { Minimap } from './render/minimap.js';
import { Camera } from './input/camera.js';
import { Input } from './input/commands.js';

const $ = (id: string) => document.getElementById(id)!;

async function boot(): Promise<void> {
  const loginOverlay = $('login');
  const hud = $('hud');
  const loginForm = $('login-form') as HTMLFormElement;
  const usernameEl = $('username') as HTMLInputElement;
  const passwordEl = $('password') as HTMLInputElement;
  const errorEl = $('login-error');
  const registerBtn = $('register-btn');
  const statusEl = $('conn-status');

  const state = new ClientState();
  const renderer = new GameRenderer();
  await renderer.init();
  await loadAssets();

  const camera = new Camera(renderer);
  let net!: Net;
  let input!: Input;
  let centered = false;

  const onMessage = (msg: ServerMsg): void => {
    switch (msg.t) {
      case 'authOk':
        Net.saveToken(msg.token);
        state.playerId = msg.playerId;
        loginOverlay.classList.add('hidden');
        hud.classList.remove('hidden');
        errorEl.textContent = '';
        break;
      case 'reject':
        if (state.playerId < 0) {
          errorEl.textContent = msg.reason;
          Net.clearToken();
          loginOverlay.classList.remove('hidden');
        } else {
          input?.showToast(msg.reason);
        }
        break;
      case 'init':
        state.playerId = msg.playerId;
        state.mapTiles = msg.mapTiles;
        state.tile = msg.tile;
        state.stockpile = msg.stockpile;
        state.pop = msg.pop;
        state.reset();
        centered = false;
        renderer.setMap(msg.mapTiles, msg.tile);
        camera.centerOn(MAP_PX / 2, MAP_PX / 2);
        break;
      case 'delta':
        state.applyDelta(msg);
        if (msg.you) Object.assign(state.stockpile, msg.you);
        if (msg.pop) state.pop = msg.pop;
        break;
    }
  };

  net = new Net({
    onMessage,
    onStatus: (s) => {
      statusEl.textContent =
        s === 'open' ? 'connected' : s === 'connecting' ? 'connecting…' : 'disconnected — reconnecting…';
    },
  });

  input = new Input(renderer, state, net);
  const minimap = new Minimap(renderer, state, (wx, wy) => camera.centerOn(wx, wy));

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    net.send({ t: 'login', username: usernameEl.value, password: passwordEl.value });
  });
  registerBtn.addEventListener('click', () => {
    net.send({ t: 'register', username: usernameEl.value, password: passwordEl.value });
  });

  net.connect();

  let minimapAccum = 0;
  renderer.app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    camera.update(dt);
    renderer.entities.frame(state, dt);
    renderer.fog.update(state);
    input.update();

    if (!centered) {
      for (const [, e] of state.entities) {
        if (e.view.owner === state.playerId) {
          camera.centerOn(e.view.x, e.view.y);
          centered = true;
          break;
        }
      }
    }

    // HUD.
    $('r-wood').textContent = String(Math.floor(state.stockpile.wood));
    $('r-gold').textContent = String(Math.floor(state.stockpile.gold));
    $('r-food').textContent = String(Math.floor(state.stockpile.food));
    $('r-stone').textContent = String(Math.floor(state.stockpile.stone));
    $('r-pop').textContent = `${state.pop.used}/${state.pop.cap}`;

    // Minimap a few times per second.
    minimapAccum += ticker.deltaMS;
    if (minimapAccum > 200) {
      minimapAccum = 0;
      minimap.draw();
    }
  });
}

void boot();
