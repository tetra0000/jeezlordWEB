// Verifies server-persistent corpses: a dead unit leaves a NEUTRAL 'corpse'
// world entity (owner null => visible to anyone in vision, not withheld like an
// enemy) carrying the unit kind + team + a fade, and it decays away after
// CORPSE_TTL_S. Run with TIME_SCALE=30 so the 15-min TTL collapses to ~30s.
import WebSocket from 'ws';

const TILE = 32;
const user = 'corpse_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
const send = (m) => ws.send(JSON.stringify(m));

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, { ...ents.get(e.id), ...e });
    for (const id of (m.leave ?? [])) ents.delete(id);
  }
});

const results = [];
const check = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${name} ${extra}`); };
const corpses = () => [...ents.values()].filter((e) => e.kind === 'corpse');

let victim, corpseId, firstFade;
setTimeout(() => {
  victim = [...ents.values()].find((e) => e.owner === pid && e.kind === 'villager');
  check('found a villager to kill', !!victim, `id=${victim?.id}`);
  if (victim) send({ t: 'delete', unitIds: [victim.id] });
}, 1500);

setTimeout(() => {
  const c = corpses()[0];
  check('a corpse entity appeared', !!c, `count=${corpses().length}`);
  if (c) {
    corpseId = c.id;
    firstFade = c.corpse?.fade;
    check('corpse is neutral (owner null) → all players can see it', c.owner === null, `owner=${c.owner}`);
    check('corpse carries the dead unit kind', c.corpse?.kind === 'villager', `kind=${c.corpse?.kind}`);
    check('corpse keeps the team (original owner)', c.corpse?.team === pid, `team=${c.corpse?.team}`);
    check('corpse is near where the unit died', Math.hypot(c.x - victim.x, c.y - victim.y) < TILE, `d=${Math.round(Math.hypot(c.x - victim.x, c.y - victim.y))}px`);
    check('corpse starts ~fresh (fade ~1)', firstFade > 0.9 && firstFade <= 1, `fade=${firstFade}`);
  }
}, 3500);

// After ~half the (fast-forwarded) TTL the fade should have dropped noticeably.
setTimeout(() => {
  const c = ents.get(corpseId);
  check('corpse fade decreased over time', c && c.corpse.fade < firstFade, `fade ${firstFade} -> ${c?.corpse?.fade}`);
}, 21000);

// After the full TTL (~30s at TIME_SCALE=30, +margin) the corpse is gone.
setTimeout(() => {
  check('corpse decayed away and was removed', !ents.has(corpseId), `present=${ents.has(corpseId)}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 38000);
