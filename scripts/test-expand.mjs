// Verifies the v10 expansion rules: Town Centers start named, and Lumber/Mining
// Camps may be placed OUTSIDE your own territory (anywhere not in enemy land).
// Run against a server (TIME_SCALE=30 fine).
import WebSocket from 'ws';

const TILE = 32;
const user = 'exp_' + Math.floor(Date.now() % 100000);
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
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e.id ? { ...ents.get(e.id), ...e } : e);
    for (const id of m.leave) ents.delete(id);
  }
});

const results = [];
const check = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${name} ${extra}`); };

let tc;
let placed = false;
setTimeout(() => {
  tc = own('townCenter')[0];
  check('Town Center starts named', !!tc?.name && typeof tc.name === 'string' && tc.name.length > 0, `name=${JSON.stringify(tc?.name)}`);
  // Building on fog is forbidden, so scout the target area first: send the
  // starting scout squad ~30 tiles out, then build camps inside ITS vision.
  const tcx = Math.round(tc.x / TILE), tcy = Math.round(tc.y / TILE);
  const dir = tcx < 384 ? 1 : -1;
  const scout = own('scoutCavalry')[0];
  send({ t: 'move', unitIds: [scout.id], x: (tcx + dir * 30) * TILE, y: tcy * TILE });
}, 1500);

// Once the scout is far enough out, probe camp placements around it (their
// footprints are inside its vision, and well outside the ~15-tile territory).
const probe = setInterval(() => {
  if (placed || !tc) return;
  const scout = own('scoutCavalry')[0];
  if (!scout || Math.hypot(scout.x - tc.x, scout.y - tc.y) < 25 * TILE) return;
  placed = true;
  const sx = Math.round(scout.x / TILE), sy = Math.round(scout.y / TILE);
  for (let i = 0; i < 10; i++)
    send({ t: 'build', kind: 'lumbercamp', tileX: sx + (i % 4) - 2, tileY: sy + Math.floor(i / 4) - 1 });
}, 1000);

setTimeout(() => {
  clearInterval(probe);
  const r = (tc.territory ?? 15) * TILE;
  const outside = own('lumbercamp').filter((e) => Math.hypot(e.x - tc.x, e.y - tc.y) > r);
  check('scout reached the frontier (placement probes fired)', placed);
  check('Lumber Camp placed outside own territory', outside.length >= 1,
    `outside=${outside.length} total=${own('lumbercamp').length}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 40000);
