// Verifies the resource/drop-off rework:
//  - resources stay visible through fog once discovered (AoE memory),
//  - a resource-specific camp (lumber camp) accepts wood deposits.
// A scout villager actively hunts (redirecting to new far waypoints) until it
// discovers a distant resource node, then is recalled so the node is left in
// fog; we assert it's still sent. Run against TIME_SCALE=30.
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

let scoutId = -1;
let scoutHome = null;
let farNodeId = -1;
let wood0 = 0;

// Kick off: gather + build a lumber camp with two villagers near home (wood
// drop-off), and start the scout hunting with the third.
setTimeout(() => {
  const tc = own('townCenter')[0];
  const vills = own('villager');
  scoutId = vills[0].id;
  scoutHome = { x: vills[0].x, y: vills[0].y };

  const tree = [...ents.values()].find((e) => e.kind === 'tree' && dist(e, tc) < 250);
  if (tree) {
    wood0 = stock.wood;
    send({ t: 'gather', unitIds: vills.slice(1).map((v) => v.id), nodeId: tree.id });
    send({ t: 'build', builderIds: [], kind: 'lumbercamp', tileX: Math.round(tree.x / TILE) + 1, tileY: Math.round(tree.y / TILE) });
  }
  hunt();
}, 700);

// Redirect the scout to fresh far waypoints until a distant node is discovered.
const tcPos = () => own('townCenter')[0];
let hopSeed = 1;
function hunt() {
  const tc = tcPos();
  if (!tc) return;
  if (farNodeId < 0) {
    const far = [...ents.values()].find((e) => e.owner == null && e.amount != null && dist(e, tc) > FAR);
    if (far) {
      farNodeId = far.id;
      console.log('discovered far node', farNodeId, 'dist', Math.round(dist(far, tc)));
      send({ t: 'move', unitIds: [scoutId], x: scoutHome.x, y: scoutHome.y }); // recall
      return;
    }
    // Explore a new pseudo-random far point.
    hopSeed = (hopSeed * 1103515245 + 12345) & 0x7fffffff;
    const ang = (hopSeed % 360) * (Math.PI / 180);
    send({ t: 'move', unitIds: [scoutId], x: clampPx(tc.x + Math.cos(ang) * 1600), y: clampPx(tc.y + Math.sin(ang) * 1600) });
    setTimeout(hunt, 4000); // allow time to travel (units move 5x slower now)
  }
}

// Final assertions.
setTimeout(() => {
  const far = ents.get(farNodeId);
  const ownUnits = [...ents.values()].filter((e) => e.owner === pid);
  const minToOwn = far ? Math.min(...ownUnits.map((u) => dist(far, u))) : 0;
  check('discovered a distant node while scouting', farNodeId > 0);
  check('far node still sent through fog (persisted + out of vision)',
    far != null && minToOwn > VIS, far ? `nearest own unit ${Math.round(minToOwn)}px` : 'gone');
  check('lumber camp built (wood drop-off)', own('lumbercamp').length >= 1, `camps=${own('lumbercamp').length}`);
  check('wood gathered + deposited', stock.wood > wood0, `${wood0} -> ${stock.wood}`);

  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}, 30000);
