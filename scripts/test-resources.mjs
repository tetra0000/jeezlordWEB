// Verifies the resource/drop-off rework under the v8 job model:
//  - lumberjacks gather wood and a lumber camp accepts the deposit,
//  - resources stay visible through fog once discovered (AoE memory).
// Villagers can no longer be hand-controlled, so the "scout" is a trained
// infantry unit: it hunts distant waypoints until it discovers a far node, then
// is recalled so the node falls back into fog; we assert it's still sent.
// Run against a fast-forwarded server (TIME_SCALE=30).
import WebSocket from 'ws';

const TILE = 32;
const VIS = 230; // ~Town Center vision radius (px)
const FAR = 500; // a "distant" node, clearly beyond any home unit's vision
const user = 'res_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
let stock = null;
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clampPx = (n) => Math.max(500, Math.min(15884, n));

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'reject') console.error('REJECT:', m.reason);
  else if (m.t === 'init') stock = m.stockpile;
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e);
    for (const id of m.leave) ents.delete(id);
    if (m.you) Object.assign(stock, m.you);
  }
});

const results = [];
const check = (n, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${n} ${extra}`); };

function freeSpot(near, fp) {
  const blocked = new Set();
  for (const e of ents.values()) {
    const tx = Math.round(e.x / TILE), ty = Math.round(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  const free = (tx, ty) => {
    for (let dy = 0; dy < fp; dy++) for (let dx = 0; dx < fp; dx++) if (blocked.has(`${tx + dx},${ty + dy}`)) return false;
    return true;
  };
  const cx = Math.round(near.x / TILE), cy = Math.round(near.y / TILE);
  for (let r = 3; r <= 9; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (free(cx + dx, cy + dy)) return { tileX: cx + dx, tileY: cy + dy };
  return { tileX: cx, tileY: cy + 6 };
}

let scoutId = -1;
let scoutHome = null;
let farNodeId = -1;
let wood0 = 0;

// Kick off: assign lumberjacks (gather wood) + drop a lumber camp by a tree, and
// place a barracks so we can train a scout.
setTimeout(() => {
  const tc = own('townCenter')[0];
  const tree = [...ents.values()].find((e) => e.kind === 'tree' && dist(e, tc) < 300);
  wood0 = stock.wood;
  send({ t: 'assignJob', job: 'lumberjack', count: 2 });
  if (tree) send({ t: 'build', kind: 'lumbercamp', tileX: Math.round(tree.x / TILE) + 1, tileY: Math.round(tree.y / TILE) });
  const spot = freeSpot(tc, 3);
  send({ t: 'build', kind: 'barracks', tileX: spot.tileX, tileY: spot.tileY });
  console.log('assigned lumberjacks; placed lumber camp + barracks');
}, 800);

// Once the barracks is up, train an infantry scout.
let trained = false;
const trainTimer = setInterval(() => {
  if (trained) return;
  const b = own('barracks')[0];
  if (b && b.build == null) {
    trained = true;
    send({ t: 'train', buildingId: b.id, unit: 'infantry' });
    console.log('barracks done; training infantry scout');
  }
}, 1000);

// When the scout exists, send it hunting far waypoints until it finds a distant
// node, then recall it so the node is left in fog.
let hopSeed = 1;
const huntTimer = setInterval(() => {
  const tc = own('townCenter')[0];
  if (!tc) return;
  if (scoutId < 0) {
    const inf = own('infantry')[0];
    if (!inf) return;
    scoutId = inf.id;
    scoutHome = { x: inf.x, y: inf.y };
    console.log('scout spawned', scoutId);
  }
  if (farNodeId < 0) {
    const far = [...ents.values()].find((e) => e.owner == null && e.amount != null && dist(e, tc) > FAR);
    if (far) {
      farNodeId = far.id;
      console.log('discovered far node', farNodeId, 'dist', Math.round(dist(far, tc)));
      send({ t: 'move', unitIds: [scoutId], x: scoutHome.x, y: scoutHome.y }); // recall
      clearInterval(huntTimer);
      return;
    }
    hopSeed = (hopSeed * 1103515245 + 12345) & 0x7fffffff;
    const ang = (hopSeed % 360) * (Math.PI / 180);
    send({ t: 'move', unitIds: [scoutId], x: clampPx(tc.x + Math.cos(ang) * 1600), y: clampPx(tc.y + Math.sin(ang) * 1600) });
  }
}, 3500);

// Final assertions.
setTimeout(() => {
  clearInterval(trainTimer);
  clearInterval(huntTimer);
  const far = ents.get(farNodeId);
  const ownUnits = [...ents.values()].filter((e) => e.owner === pid);
  const minToOwn = far ? Math.min(...ownUnits.map((u) => dist(far, u))) : 0;
  check('lumberjacks gathered + deposited wood', stock.wood > wood0, `${wood0} -> ${stock.wood}`);
  check('lumber camp built (wood drop-off)', own('lumbercamp').length >= 1, `camps=${own('lumbercamp').length}`);
  check('discovered a distant node while scouting', farNodeId > 0);
  check('far node still sent through fog (persisted + out of vision)',
    far != null && minToOwn > VIS, far ? `nearest own unit ${Math.round(minToOwn)}px` : 'gone');

  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}, 45000);
