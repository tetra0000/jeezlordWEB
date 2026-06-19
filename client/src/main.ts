// Client entrypoint: wires the login UI, the network layer, the Pixi renderer,
// and the per-frame update loop (camera + entity interpolation + fog + minimap
// + HUD).
import { MAP_PX, TILE } from '../../shared/constants.js';
import { decodeTerrainRLE } from '../../shared/terrain.js';
import { isBuilding, isResourceNode } from '../../shared/stats.js';
import type { DeltaMsg, ServerMsg } from '../../shared/protocol.js';
import { ClientState } from './state.js';
import { Net } from './net.js';
import { GameRenderer } from './render/app.js';
import { loadAssets } from './render/assets.js';
import { Minimap } from './render/minimap.js';
import { PerfHud } from './render/perfHud.js';
import { Camera } from './input/camera.js';
import { Input } from './input/commands.js';
import { sound, panAt, vary } from './audio/sound.js';

const $ = (id: string) => document.getElementById(id)!;

// Turn a world delta into audible/visible events by diffing against the state
// we still hold (call this BEFORE applyDelta overwrites it):
//  - hp drop on a visible unit/building -> combat impact
//  - an entity in `dead` -> destroyed: death sound + FX, and units leave a corpse
//  - an owned foundation finishing (build: number -> undefined) -> completion
function emitDeltaSounds(state: ClientState, msg: DeltaMsg, r: GameRenderer): void {
  const me = state.playerId;
  const onScreen = (sx: number, sy: number): boolean =>
    sx >= -60 && sx <= window.innerWidth + 60 && sy >= -60 && sy <= window.innerHeight + 60;

  for (const v of msg.update) {
    const old = state.entities.get(v.id);
    if (!old) continue;
    const ov = old.view;
    const sp = r.worldToScreen(v.x, v.y);
    const vis = onScreen(sp.x, sp.y);

    if (ov.build != null && v.build == null && v.owner === me && isBuilding(v.kind)) {
      if (vis) {
        sound.play('complete', { pan: panAt(sp.x) });
        r.entities.completeFx(v.x, v.y);
      } else {
        sound.play('complete');
      }
      continue;
    }
    if (v.hp < ov.hp - 0.01 && !isResourceNode(v.kind) && vis) {
      sound.play('hit', { pan: panAt(sp.x), rate: vary(0.25) });
      r.entities.hitFx(v.x, v.y);
    }
  }

  // Deaths (any owner you could see) — distinct from units merely walking into
  // fog (those arrive only in `leave`). Units leave a lingering corpse.
  for (const id of msg.dead ?? []) {
    const old = state.entities.get(id);
    if (!old) continue;
    const sp = r.worldToScreen(old.rx, old.ry);
    const vis = onScreen(sp.x, sp.y);
    sound.play('death', { pan: vis ? panAt(sp.x) : 0, rate: vary(0.25) });
    // The lingering corpse is a real server entity now (it arrives via `enter`);
    // here we just punch the instant-of-death dust + sound.
    if (vis) r.entities.deathFx(old.rx, old.ry);
  }
}

async function boot(): Promise<void> {
  const loginOverlay = $('login');
  const hud = $('hud');
  const loginForm = $('login-form') as HTMLFormElement;
  const usernameEl = $('username') as HTMLInputElement;
  const passwordEl = $('password') as HTMLInputElement;
  const errorEl = $('login-error');
  const registerBtn = $('register-btn');
  const statusEl = $('conn-status');

  const defeatOverlay = $('defeat');
  const restartBtn = $('restart-btn');
  const refreshDefeat = (): void => {
    defeatOverlay.classList.toggle('hidden', !state.defeated);
  };

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
        sound.play('complete');
        break;
      case 'reject':
        if (state.playerId < 0) {
          errorEl.textContent = msg.reason;
          Net.clearToken();
          loginOverlay.classList.remove('hidden');
        } else {
          input?.showToast(msg.reason);
        }
        sound.play('error');
        break;
      case 'init':
        state.playerId = msg.playerId;
        state.mapTiles = msg.mapTiles;
        state.tile = msg.tile;
        state.stockpile = msg.stockpile;
        state.pop = msg.pop;
        state.terrain = decodeTerrainRLE(msg.terrain, msg.mapTiles * msg.mapTiles);
        state.reset();
        centered = false;
        renderer.setMap(msg.mapTiles, msg.tile, state.terrain);
        camera.centerOn(MAP_PX / 2, MAP_PX / 2);
        refreshDefeat(); // a fresh init (incl. after restart) clears defeat
        break;
      case 'delta':
        emitDeltaSounds(state, msg, renderer);
        state.applyDelta(msg);
        if (msg.you) Object.assign(state.stockpile, msg.you);
        if (msg.pop) state.pop = msg.pop;
        if (msg.defeated !== undefined) refreshDefeat();
        break;
      case 'adminState':
        state.adminEnabled = msg.enabled;
        state.adminReveal = msg.reveal;
        input?.showToast(
          msg.enabled ? `admin mode ON${msg.reveal ? ' · fog revealed' : ''}` : 'admin mode OFF',
        );
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
  const perf = new PerfHud();

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    net.send({ t: 'login', username: usernameEl.value, password: passwordEl.value });
  });
  registerBtn.addEventListener('click', () => {
    net.send({ t: 'register', username: usernameEl.value, password: passwordEl.value });
  });

  // Restart after defeat: ask the server to wipe + re-seed us. The server
  // replies with a fresh `init`, which clears the overlay. Disable to avoid
  // double-sends until that init arrives.
  restartBtn.addEventListener('click', () => {
    (restartBtn as HTMLButtonElement).disabled = true;
    net.send({ t: 'restart' });
    setTimeout(() => ((restartBtn as HTMLButtonElement).disabled = false), 3000);
  });

  // Sound mute toggle (button + 'M' key).
  const soundBtn = $('sound-toggle');
  const refreshSoundBtn = (): void => {
    soundBtn.textContent = sound.muted ? '🔇' : '🔊';
    soundBtn.classList.toggle('muted', sound.muted);
  };
  refreshSoundBtn();
  soundBtn.addEventListener('click', () => {
    sound.toggleMute();
    refreshSoundBtn();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      const muted = sound.toggleMute();
      refreshSoundBtn();
      input?.showToast(muted ? 'sound off' : 'sound on');
    }
  });

  net.connect();

  let minimapAccum = 0;
  let overlayAccum = 1000; // force fog/territory to draw on the first frame
  renderer.app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    camera.update(dt);

    // Padded camera rect in world px — drives entity viewport culling so render
    // cost tracks what's on screen, not the (fog-revealed) whole-world count.
    const tl = renderer.screenToWorld(0, 0);
    const br = renderer.screenToWorld(renderer.screenWidth, renderer.screenHeight);
    const pad = TILE * 4; // cover large building footprints + reduce pan pop-in
    renderer.entities.frame(state, dt, {
      minX: tl.x - pad,
      minY: tl.y - pad,
      maxX: br.x + pad,
      maxY: br.y + pad,
    });

    // Fog + territory barely change frame-to-frame and each rebuild their
    // Graphics geometry over a full scan of the world, so refresh them at ~20 Hz
    // instead of every frame. Panning/zoom still tracks at full rate (it's a
    // container transform; only the redraw is throttled).
    overlayAccum += ticker.deltaMS;
    if (overlayAccum >= 50) {
      overlayAccum = 0;
      renderer.territory.draw(state);
      renderer.fog.update(state);
    }

    input.update();
    perf.frame(ticker.deltaMS, {
      entities: state.entities.size,
      sprites: renderer.entities.spriteCount,
      fx: renderer.entities.fxCount,
    });

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
