// Territory verification: the TC reports a territory radius; building far outside
// it is rejected; building just inside succeeds. Run with TIME_SCALE=30.
import WebSocket from 'ws';

const TILE = 32;
const user = 'terr_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
let mapTiles = 512;
const rejects = [];
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'init') mapTiles = m.mapTiles;
  else if (m.t === 'reject') rejects.push(m.reason);
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e);
    for (const id of m.leave) ents.delete(id);
  }
});

const results = [];
const check = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${name} ${extra}`); };

setTimeout(() => {
  const tc = own('townCenter')[0];
  check('TC reports a territory radius (~10)', tc && tc.territory >= 9.9 && tc.territory <= 11, `territory=${tc?.territory}`);
  const tcx = Math.round(tc.x / TILE), tcy = Math.round(tc.y / TILE);
  // Far outside territory but in-bounds (30 tiles toward map centre): expect a
  // territory reject (not an out-of-bounds one).
  const dir = tcx < mapTiles / 2 ? 1 : -1;
  send({ t: 'build', kind: 'house', tileX: tcx + dir * 30, tileY: tcy });
  // Just inside territory (3 tiles north): expect success.
  send({ t: 'build', kind: 'house', tileX: tcx - 1, tileY: tcy - 4 });
}, 1500);

setTimeout(() => {
  const gotTerritoryReject = rejects.some((r) => /territory/i.test(r));
  check('build outside territory was rejected', gotTerritoryReject, `rejects=${JSON.stringify(rejects)}`);
  check('build inside territory succeeded', own('house').length >= 1, `houses=${own('house').length}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 6000);
