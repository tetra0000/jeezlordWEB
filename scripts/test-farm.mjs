// Farm verification (AoE2-style): build a farm inside territory, let villagers
// finish it, then assign them to harvest it and confirm food rises as they haul
// it to the Town Center. Run against a fast-forwarded server (TIME_SCALE=30).
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

// Find a free 2x2 spot near a point, staying close (within territory ~10 tiles).
function freeSpot(near) {
  const blocked = new Set();
  for (const e of ents.values()) {
    const tx = Math.round(e.x / TILE), ty = Math.round(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  const cx = Math.round(near.x / TILE), cy = Math.round(near.y / TILE);
  for (let r = 3; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (!blocked.has(`${tx},${ty}`) && !blocked.has(`${tx + 1},${ty}`) && !blocked.has(`${tx},${ty + 1}`) && !blocked.has(`${tx + 1},${ty + 1}`))
        return { tileX: tx, tileY: ty };
    }
  return { tileX: cx, tileY: cy + 6 };
}

let farmId = -1;
setTimeout(() => {
  const tc = own('townCenter')[0];
  const { tileX, tileY } = freeSpot(tc);
  send({ t: 'build', kind: 'farm', tileX, tileY });
  console.log('placed farm at', tileX, tileY, '(builder villagers auto-build it)');
}, 800);

// Once the farm completes, assign a farmer (1 slot per farm) to harvest it.
let builtOk = false;
let foodBaseline = 0;
setTimeout(() => {
  const farms = own('farm');
  builtOk = farms.length >= 1 && farms.every((f) => f.build == null);
  console.log(`${builtOk ? 'PASS' : 'FAIL'}: farm built & complete (${farms.length})`);
  if (builtOk) {
    farmId = farms[0].id;
    foodBaseline = Math.floor(stock.food);
    send({ t: 'assignJob', job: 'farmer', count: 1 });
    console.log('assigned 1 farmer; food baseline', foodBaseline);
  }
}, 6000);

setTimeout(() => {
  const farm = ents.get(farmId);
  const grew = Math.floor(stock.food) > foodBaseline;
  const depleting = farm && farm.amount != null && farm.amount < 1750;
  console.log(`${grew ? 'PASS' : 'FAIL'}: food rose from harvest ${foodBaseline} -> ${Math.floor(stock.food)}`);
  console.log(`${depleting ? 'PASS' : 'FAIL'}: farm store is being consumed (amount=${farm?.amount})`);
  process.exit(builtOk && grew && depleting ? 0 : 1);
}, 12000);
