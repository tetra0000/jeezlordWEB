// Verifies territory is LOST when a town center is destroyed: with the TC gone,
// its border disappears and you can no longer build inside the old zone (only a
// new TC, anywhere). Run with TIME_SCALE=30.
import WebSocket from 'ws';

const TILE = 32;
const user = 'tloss_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
const rejects = [];
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'reject') rejects.push(m.reason);
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, { ...ents.get(e.id), ...e });
    for (const id of (m.leave ?? [])) ents.delete(id);
  }
});

const results = [];
const check = (n, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${n} ${extra}`); };

let tc, tcx, tcy;
setTimeout(() => {
  tc = own('townCenter')[0];
  check('start with a TC projecting territory', !!tc && tc.territory > 0, `territory=${tc?.territory}`);
  tcx = Math.round(tc.x / TILE); tcy = Math.round(tc.y / TILE);
  send({ t: 'delete', unitIds: [tc.id] }); // destroy our own TC
}, 1500);

setTimeout(() => {
  check('TC is gone after destruction', own('townCenter').length === 0, `count=${own('townCenter').length}`);
  // Try to build a house where territory used to be — should now be rejected
  // (no territory left); only a new TC is allowed.
  send({ t: 'build', kind: 'house', tileX: tcx - 1, tileY: tcy - 4 });
}, 3500);

setTimeout(() => {
  check('cannot build in the old (now-lost) territory', own('house').length === 0 && rejects.some((r) => /town center first/i.test(r)),
    `houses=${own('house').length} rejects=${JSON.stringify(rejects)}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 5500);
