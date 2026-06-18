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

    // Villagers are no longer hand-controlled — assign a lumberjack job and
    // confirm a villager walks off toward a tree (movement via deltas).
    if (firstUnit < 0) {
      for (const [id, e] of entities) {
        if (e.owner === playerId && e.kind === 'villager') {
          firstUnit = id;
          startPos = { x: e.x, y: e.y };
          movedTo = startPos;
          console.log(`own units: ${[...entities.values()].filter((v) => v.owner === playerId).length}; assigning lumberjacks (villager ${id} at (${e.x.toFixed(0)},${e.y.toFixed(0)}) should walk to a tree)`);
          send({ t: 'assignJob', job: 'lumberjack', count: 2 });
          break;
        }
      }
    }
  }
});

// After a few seconds, report whether any villager walked off to work. (Use the
// max displacement across villagers — the tracked one may stay a builder.)
setTimeout(() => {
  const vills = [...entities.values()].filter((v) => v.owner === playerId && v.kind === 'villager');
  if (vills.length === 0) {
    console.error('FAIL: no villagers');
    process.exit(1);
  }
  // Villagers all start clustered by the TC, so distance from the tracked
  // villager's start approximates each one's displacement; take the max (the
  // lumberjacks walk off, even if the tracked one stayed a builder).
  const movedDist = Math.max(...vills.map((v) => Math.hypot(v.x - startPos.x, v.y - startPos.y)));
  console.log(`furthest villager moved ${movedDist.toFixed(0)}px`);
  if (movedDist > 50) {
    console.log('PASS: movement applied via authoritative deltas');
    process.exit(0);
  } else {
    console.error('FAIL: villager did not move (no tree in range, or movement broken)');
    process.exit(1);
  }
}, 6000);

ws.on('error', (e) => {
  console.error('ws error', e.message);
  process.exit(1);
});
