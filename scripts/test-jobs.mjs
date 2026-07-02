// Villager-jobs verification (v8): assigning job counts reconciles villagers,
// the Town Center caps each job at 2, over-assigning is clamped (to capacity and
// to the villagers available), the remainder are builders, and building a lumber
// camp raises the lumberjack cap. Run against a fast-forwarded server
// (TIME_SCALE=30).
import WebSocket from 'ws';

const TILE = 32;
const user = 'jobs_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
let stock = null;
let jobs = null;
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

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
    if (m.jobs) jobs = m.jobs;
  }
});

function freeSpot(near) {
  const blocked = new Set();
  for (const e of ents.values()) {
    const tx = Math.round(e.x / TILE), ty = Math.round(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  const cx = Math.round(near.x / TILE), cy = Math.round(near.y / TILE);
  for (let r = 3; r <= 9; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (!blocked.has(`${cx + dx},${cy + dy}`)) return { tileX: cx + dx, tileY: cy + dy };
  return { tileX: cx, tileY: cy + 5 };
}

const results = [];
const check = (n, c, e = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${e}`); };

// Start: 3 builders. Assign 2 lumberjacks.
setTimeout(() => {
  check('starts with 3 villagers, all builders', jobs && jobs.total === 3 && jobs.counts.builder === 3, JSON.stringify(jobs?.counts));
  check('Town Center caps lumberjacks at 2', jobs && jobs.caps.lumberjack === 2, `cap=${jobs?.caps.lumberjack}`);
  send({ t: 'assignJob', job: 'lumberjack', count: 2 });
}, 1500);

setTimeout(() => {
  check('2 lumberjacks assigned, 1 builder remains', jobs && jobs.counts.lumberjack === 2 && jobs.counts.builder === 1, JSON.stringify(jobs?.counts));
  // Over-assign gold miners: capacity is 2 but only 1 villager is free.
  send({ t: 'assignJob', job: 'goldminer', count: 9 });
}, 4000);

setTimeout(() => {
  check('over-assign clamped by available villagers (1 gold miner, 0 builders)',
    jobs && jobs.counts.goldminer === 1 && jobs.counts.builder === 0, JSON.stringify(jobs?.counts));
  // Free the gold miner, then build a lumber camp (raises lumberjack cap to 4).
  send({ t: 'assignJob', job: 'goldminer', count: 0 });
  const tc = own('townCenter')[0];
  const { tileX, tileY } = freeSpot(tc);
  send({ t: 'build', kind: 'lumbercamp', tileX, tileY });
}, 6000);

setTimeout(() => {
  check('lumber camp built', own('lumbercamp').length >= 1, `camps=${own('lumbercamp').length}`);
  // TC grants 2 lumberjack slots; each camp adds 5 (v13).
  check('lumberjack cap rose to 7 with a lumber camp', jobs && jobs.caps.lumberjack === 7, `cap=${jobs?.caps.lumberjack}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}, 13000);
