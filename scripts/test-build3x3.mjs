// Verify a 3x3 building (barracks) actually completes with villagers building it
// (the foundation/BUILD_RANGE edge case). Run with TIME_SCALE=30.
import WebSocket from 'ws';

const TILE = 32;
const user = 'b3_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'reject') console.error('REJECT', m.reason);
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e);
    for (const id of m.leave) ents.delete(id);
  }
});

// Free 3x3 spot near TC, staying inside territory.
function freeSpot3(near) {
  const blocked = new Set();
  for (const e of ents.values()) {
    const tx = Math.round(e.x / TILE), ty = Math.round(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  const free = (tx, ty) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (blocked.has(`${tx + dx},${ty + dy}`)) return false;
    return true;
  };
  const cx = Math.round(near.x / TILE), cy = Math.round(near.y / TILE);
  for (let r = 3; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (free(cx + dx, cy + dy)) return { tileX: cx + dx, tileY: cy + dy };
  return { tileX: cx, tileY: cy + 6 };
}

// First put every villager on a gathering job (TC supports 2 lumberjacks + 2
// stonemasons), leaving NO builders, then place the barracks: with no builder
// it must NOT progress.
setTimeout(() => {
  send({ t: 'assignJob', job: 'lumberjack', count: 2 });
  send({ t: 'assignJob', job: 'stonemason', count: 1 });
}, 600);

setTimeout(() => {
  const tc = own('townCenter')[0];
  const { tileX, tileY } = freeSpot3(tc);
  send({ t: 'build', kind: 'barracks', tileX, tileY });
  console.log('placed barracks (3x3) foundation with no builders, at', tileX, tileY);
}, 1200);

const results = [];
const check = (n, c, e = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${e}`); };

// With every villager assigned elsewhere, the foundation should be ~0%. Then
// free them all back to builders and watch it complete.
setTimeout(() => {
  const b = own('barracks')[0];
  check('foundation does NOT auto-build with no builders', b && b.build != null && b.build < 0.05, `build=${b?.build}`);
  send({ t: 'assignJob', job: 'lumberjack', count: 0 });
  send({ t: 'assignJob', job: 'stonemason', count: 0 });
  console.log('freed villagers back to builders');
}, 4000);

setTimeout(() => {
  const b = own('barracks')[0];
  check('3x3 barracks completes once builders work it', b && b.build == null, `build=${b?.build}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 11000);
