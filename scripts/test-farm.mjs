// v7 verification: a farm trickles food to the owner over time. Run against a
// fast-forwarded server (TIME_SCALE=30).
import WebSocket from 'ws';

const TILE = 32;
const user = 'farm_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
let stock = null;
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'reject') console.error('REJECT', m.reason);
  else if (m.t === 'init') stock = m.stockpile;
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e);
    for (const id of m.leave) ents.delete(id);
    if (m.you) Object.assign(stock, m.you);
  }
});

function freeSpot(near) {
  const blocked = new Set();
  for (const e of ents.values()) {
    const tx = Math.round(e.x / TILE), ty = Math.round(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  const cx = Math.round(near.x / TILE), cy = Math.round(near.y / TILE);
  for (let r = 3; r <= 14; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (!blocked.has(`${tx},${ty}`) && !blocked.has(`${tx + 1},${ty}`) && !blocked.has(`${tx},${ty + 1}`) && !blocked.has(`${tx + 1},${ty + 1}`))
        return { tileX: tx, tileY: ty };
    }
  return { tileX: cx, tileY: cy + 12 };
}

let foodBeforeComplete = 0;
setTimeout(() => {
  const tc = own('townCenter')[0];
  const { tileX, tileY } = freeSpot(tc);
  send({ t: 'build', builderIds: own('villager').map((v) => v.id), kind: 'farm', tileX, tileY });
  console.log('built farm at', tileX, tileY);
}, 800);

// Once the farm completes: assert it built (before a finite farm can deplete),
// record the food baseline, then verify food rises from the farm trickle.
let builtOk = false;
setTimeout(() => {
  const farms = own('farm');
  builtOk = farms.length >= 1 && farms.every((f) => f.build == null);
  foodBeforeComplete = Math.floor(stock.food);
  console.log(`${builtOk ? 'PASS' : 'FAIL'}: farm built & complete (${farms.length})`);
  console.log('food baseline:', foodBeforeComplete);
}, 5000);
setTimeout(() => {
  const grew = Math.floor(stock.food) > foodBeforeComplete;
  console.log(`${grew ? 'PASS' : 'FAIL'}: farm produced food ${foodBeforeComplete} -> ${Math.floor(stock.food)}`);
  process.exit(builtOk && grew ? 0 : 1);
}, 8000);
