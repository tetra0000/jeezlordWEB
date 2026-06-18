// Economy verification (job-based): assign lumberjacks -> wood rises; place a
// house (built automatically by the kingdom's builder villagers) -> pop cap
// rises; train a villager. Run against a fast-forwarded server (TIME_SCALE=30).
// Villagers are no longer hand-controlled — the player only assigns jobs.
import WebSocket from 'ws';

const TILE = 32;
const user = 'eco_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
let stock = null;
let pop = { used: 0, cap: 0 };
let jobs = null;
const log = (...a) => console.log(...a);
const send = (m) => ws.send(JSON.stringify(m));

const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

// Find a free 2x2 build spot near a point by scanning outward, treating every
// known entity (with a margin) as blocked.
function freeSpot(near) {
  const blocked = new Set();
  for (const e of ents.values()) {
    const tx = Math.round(e.x / TILE);
    const ty = Math.round(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  const cx = Math.round(near.x / TILE);
  const cy = Math.round(near.y / TILE);
  for (let r = 3; r <= 14; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = cx + dx, ty = cy + dy;
      const ok = !blocked.has(`${tx},${ty}`) && !blocked.has(`${tx + 1},${ty}`) &&
                 !blocked.has(`${tx},${ty + 1}`) && !blocked.has(`${tx + 1},${ty + 1}`);
      if (ok) return { tileX: tx, tileY: ty };
    }
  }
  return { tileX: cx, tileY: cy + 12 };
}

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'reject') console.error('REJECT:', m.reason);
  else if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'init') { stock = m.stockpile; pop = m.pop; log('init pop', JSON.stringify(pop)); }
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e);
    for (const id of m.leave) ents.delete(id);
    if (m.you) Object.assign(stock, m.you);
    if (m.pop) pop = m.pop;
    if (m.jobs) jobs = m.jobs;
  }
});

const results = [];
const check = (name, cond, extra = '') => { results.push(cond); log(`${cond ? 'PASS' : 'FAIL'}: ${name} ${extra}`); };

let wood0 = 0;
setTimeout(() => {
  const tree = [...ents.values()].find((e) => e.kind === 'tree');
  check('starting villagers visible (3)', own('villager').length === 3, `got ${own('villager').length}`);
  check('starter Town Center visible', own('townCenter').length === 1);
  check('resource nodes visible', tree != null);
  // Town Center gives 2 lumberjack slots; assign 2 (leaves 1 builder).
  wood0 = stock.wood;
  send({ t: 'assignJob', job: 'lumberjack', count: 2 });
  log('assigned 2 lumberjacks');
}, 800);

setTimeout(() => {
  check('jobs report shows 2 lumberjacks', jobs && jobs.counts.lumberjack === 2, `counts=${JSON.stringify(jobs?.counts)}`);
  check('wood increased (lumberjacks gathered + deposited)', stock.wood > wood0, `${wood0} -> ${stock.wood}`);
  const tc = own('townCenter')[0];
  const { tileX, tileY } = freeSpot(tc);
  send({ t: 'build', kind: 'house', tileX, tileY });
  log('placed house at', tileX, tileY, '(builders auto-build)', 'popCap', pop.cap);
}, 5000);

setTimeout(() => {
  check('house built by builder villagers', own('house').length === 1, `houses=${own('house').length}`);
  check('pop cap increased (>8)', pop.cap > 8, `cap=${pop.cap}`);
  const tc = own('townCenter')[0];
  send({ t: 'train', buildingId: tc.id, unit: 'villager' });
  log('training villager at Town Center', tc.id, 'pop', JSON.stringify(pop));
}, 10000);

let villBefore = 0;
setTimeout(() => { villBefore = own('villager').length; }, 10100);
setTimeout(() => {
  check('villager trained (count rose)', own('villager').length > villBefore, `${villBefore} -> ${own('villager').length}`);
  const failed = results.filter((c) => !c).length;
  log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}, 15000);
