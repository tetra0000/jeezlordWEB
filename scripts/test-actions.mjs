// Verifies the server emits per-unit `action` + resource `amount` (drives client
// animation + tooltip). Run against a fast-forwarded server (TIME_SCALE=30).
import WebSocket from 'ws';

const TILE = 32;
const user = 'act_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
const seenActions = new Set();
let sawResourceAmount = false;
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

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

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'reject') console.error('REJECT', m.reason);
  else if (m.t === 'delta') {
    for (const arr of [m.enter, m.update]) for (const e of arr) {
      ents.set(e.id, e);
      if (e.owner === pid && e.action) seenActions.add(e.action);
      if (e.amount != null && e.kind === 'tree') sawResourceAmount = true;
    }
    for (const id of m.leave) ents.delete(id);
  }
});

setTimeout(() => {
  // Assign lumberjacks (they walk to a tree -> move + gatherWood actions),
  // leaving a builder to raise the house (-> build action).
  send({ t: 'assignJob', job: 'lumberjack', count: 2 });
}, 700);

setTimeout(() => {
  const tc = own('townCenter')[0];
  const { tileX, tileY } = freeSpot(tc);
  send({ t: 'build', kind: 'house', tileX, tileY });
}, 4500);

setTimeout(() => {
  const results = [];
  const check = (n, c) => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n}`); };
  console.log('actions seen:', [...seenActions].join(', '));
  check('villager emitted move action', seenActions.has('move'));
  check('villager emitted gatherWood action', seenActions.has('gatherWood'));
  check('villager emitted build action', seenActions.has('build'));
  check('resource node reported amount', sawResourceAmount);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}, 9000);
