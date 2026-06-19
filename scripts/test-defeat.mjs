// Verifies defeat & restart: lose all units -> server flags `defeated` -> the
// `restart` intent re-seeds the player fresh (new init, units again, not
// defeated). Run with TIME_SCALE=30.
import WebSocket from 'ws';

const user = 'defeat_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
let defeated = false;
let initCount = 0;
const send = (m) => ws.send(JSON.stringify(m));
const ownUnits = () => [...ents.values()].filter((e) => e.owner === pid && (e.kind === 'villager' || e.kind === 'scout' || e.kind === 'infantry'));

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'init') { initCount++; ents.clear(); defeated = false; } // client resets world + defeat on init
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, { ...ents.get(e.id), ...e });
    for (const id of (m.leave ?? [])) ents.delete(id);
    if (m.defeated !== undefined) defeated = m.defeated;
  }
});

const results = [];
const check = (n, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${n} ${extra}`); };

setTimeout(() => {
  check('start with units, not defeated', ownUnits().length > 0 && !defeated, `units=${ownUnits().length} defeated=${defeated}`);
  // Delete every unit we own (villagers + scout).
  send({ t: 'delete', unitIds: ownUnits().map((e) => e.id) });
}, 1500);

setTimeout(() => {
  check('server reports defeated after losing all units', defeated === true, `defeated=${defeated} units=${ownUnits().length}`);
  send({ t: 'restart' });
}, 4000);

setTimeout(() => {
  check('restart sent a fresh init', initCount >= 2, `initCount=${initCount}`);
  check('restart gave fresh units', ownUnits().length >= 3, `units=${ownUnits().length}`);
  check('no longer defeated after restart', defeated === false, `defeated=${defeated}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 6500);
