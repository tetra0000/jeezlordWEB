// v0 smoke test: register a user, capture starting villagers, issue a move,
// and confirm the unit's position advances via deltas. Run while the server is
// up: `node scripts/smoke.mjs`
import WebSocket from 'ws';

const URL = 'ws://localhost:8081/ws';
const user = 'smoke_' + Math.floor(Date.now() % 100000);

const ws = new WebSocket(URL);
const entities = new Map();
let playerId = -1;
let firstUnit = -1;
let movedTo = null;
let startPos = null;

const send = (m) => ws.send(JSON.stringify(m));

ws.on('open', () => {
  console.log('connected; registering', user);
  send({ t: 'register', username: user, password: 'hunter2' });
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'authOk') {
    playerId = msg.playerId;
    console.log('authOk playerId=', playerId, 'token len', msg.token.length);
  } else if (msg.t === 'reject') {
    console.error('REJECT:', msg.reason);
    process.exit(1);
  } else if (msg.t === 'init') {
    console.log('init map', msg.mapTiles, 'tile', msg.tile, 'stockpile', JSON.stringify(msg.stockpile));
  } else if (msg.t === 'delta') {
    for (const e of msg.enter) entities.set(e.id, e);
    for (const e of msg.update) entities.set(e.id, e);
    for (const id of msg.leave) entities.delete(id);

    if (firstUnit < 0) {
      for (const [id, e] of entities) {
        if (e.owner === playerId) {
          firstUnit = id;
          startPos = { x: e.x, y: e.y };
          movedTo = { x: e.x + 300, y: e.y + 200 };
          console.log(`own units: ${[...entities.values()].filter((v) => v.owner === playerId).length}; moving unit ${id} from (${e.x.toFixed(0)},${e.y.toFixed(0)}) to (${movedTo.x.toFixed(0)},${movedTo.y.toFixed(0)})`);
          send({ t: 'move', unitIds: [id], x: movedTo.x, y: movedTo.y });
          break;
        }
      }
    }
  }
});

// After ~3.5s, report where the moved unit ended up.
setTimeout(() => {
  const e = entities.get(firstUnit);
  if (!e) {
    console.error('FAIL: unit vanished');
    process.exit(1);
  }
  const movedDist = Math.hypot(e.x - startPos.x, e.y - startPos.y);
  console.log(`unit now at (${e.x.toFixed(0)},${e.y.toFixed(0)}); moved ${movedDist.toFixed(0)}px`);
  if (movedDist > 50) {
    console.log('PASS: movement applied via authoritative deltas');
    process.exit(0);
  } else {
    console.error('FAIL: unit did not move');
    process.exit(1);
  }
}, 3500);

ws.on('error', (e) => {
  console.error('ws error', e.message);
  process.exit(1);
});
