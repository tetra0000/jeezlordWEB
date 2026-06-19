// Verifies the server flags real deaths in delta.dead (distinct from fog leaves).
// Deleting an owned villager removes it from the world -> it must arrive in both
// `leave` and `dead`. Run against a running server.
import WebSocket from 'ws';

const user = 'death_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
const send = (m) => ws.send(JSON.stringify(m));
const deadSeen = new Set();
const leftSeen = new Set();

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e);
    for (const id of (m.leave ?? [])) leftSeen.add(id);
    for (const id of (m.dead ?? [])) deadSeen.add(id);
  }
});

const results = [];
const check = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${name} ${extra}`); };

let victim;
setTimeout(() => {
  victim = [...ents.values()].find((e) => e.owner === pid && e.kind === 'villager');
  check('found an owned villager to kill', !!victim, `id=${victim?.id}`);
  if (victim) send({ t: 'delete', unitIds: [victim.id] });
}, 1500);

setTimeout(() => {
  check('killed villager appeared in delta.leave', leftSeen.has(victim.id));
  check('killed villager appeared in delta.dead', deadSeen.has(victim.id));
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 3500);
