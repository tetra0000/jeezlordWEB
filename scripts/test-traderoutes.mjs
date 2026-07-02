// Trade-routes e2e (v13): two players each build a market; A trains a caravan,
// discovers B's market (admin reveal), creates a 2-stop route over the wire and
// assigns the caravan. Asserts the owner-only `routes` roster arrives, the
// caravan's view carries its route, and gold lands when the caravan reaches the
// foreign stop. Run against a fast-forwarded server (TIME_SCALE=30), ideally on
// a fresh world (long marches on crowded worlds can outlast the timeouts).
import WebSocket from 'ws';

const TILE = 32;
const stamp = Math.floor(Date.now() % 100000);

function client(name) {
  const ws = new WebSocket('ws://localhost:8081/ws');
  const c = { name, ws, pid: -1, ents: new Map(), stock: null, routes: null, ready: null };
  c.ready = new Promise((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', username: `${name}_${stamp}`, password: 'hunter2' })));
    ws.on('error', (e) => { console.error(name, 'ws', e.message); process.exit(1); });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'authOk') c.pid = m.playerId;
      else if (m.t === 'init') { c.stock = m.stockpile; resolve(); }
      else if (m.t === 'reject') console.error(name, 'REJECT', m.reason);
      else if (m.t === 'delta') {
        for (const e of m.enter) c.ents.set(e.id, e);
        for (const e of m.update) c.ents.set(e.id, e);
        for (const id of m.leave) c.ents.delete(id);
        if (m.you) Object.assign(c.stock, m.you);
        if (m.routes) c.routes = m.routes;
      }
    });
  });
  return c;
}

const own = (c, kind) => [...c.ents.values()].filter((e) => e.owner === c.pid && (!kind || e.kind === kind));
const send = (c, m) => c.ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return fn();
};
const results = [];
const check = (n, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${n} ${extra}`); };

function freeSpot(c, near) {
  const blocked = new Set();
  for (const e of c.ents.values()) {
    const tx = Math.round(e.x / TILE), ty = Math.round(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blocked.add(`${tx + dx},${ty + dy}`);
  }
  const cx = Math.round(near.x / TILE), cy = Math.round(near.y / TILE);
  for (let r = 3; r <= 9; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (!blocked.has(`${cx + dx},${cy + dy}`)) return { tileX: cx + dx, tileY: cy + dy };
  return { tileX: cx, tileY: cy + 5 };
}

const A = client('trA');
const B = client('trB');
await Promise.all([A.ready, B.ready]);
await sleep(800);

// Both players raise a market next to their Town Center.
for (const c of [A, B]) {
  const tc = own(c, 'townCenter')[0];
  const { tileX, tileY } = freeSpot(c, tc);
  send(c, { t: 'build', kind: 'market', tileX, tileY });
}
check('markets complete', await until(() =>
  own(A, 'market').some((e) => e.build == null) && own(B, 'market').some((e) => e.build == null), 30000));

// A trains a caravan at its market.
const aMarket = own(A, 'market').find((e) => e.build == null);
send(A, { t: 'train', buildingId: aMarket.id, unit: 'caravan' });
check('caravan trained', await until(() => own(A, 'caravan').length > 0, 30000));
const caravan = own(A, 'caravan')[0];

// A flashes admin reveal to "discover" B's market without a long scout march,
// then turns it straight back off — a full-map reveal makes the snapshot
// serialize every entity for A each tick, which drags the whole server. The
// market must SURVIVE the reveal ending (discovered-market fog memory).
send(A, { t: 'rename', buildingId: own(A, 'townCenter')[0].id, name: 'adminmode' });
await sleep(400);
send(A, { t: 'admin', action: 'revealFog' });
check('B’s market discovered under reveal', await until(() =>
  [...A.ents.values()].some((e) => e.kind === 'market' && e.owner === B.pid), 10000));
const bMarket = [...A.ents.values()].find((e) => e.kind === 'market' && e.owner === B.pid);
send(A, { t: 'admin', action: 'revealFog' }); // toggle reveal back OFF
await sleep(1500);
check('discovered market persists through fog', A.ents.has(bMarket.id));

// Create the route over the wire, assigning the caravan in the same intent.
send(A, { t: 'tradeRoute', action: 'create', stops: [aMarket.id, bMarket.id], caravanIds: [caravan.id] });
check('routes roster arrives (owner-only delta)', await until(() =>
  (A.routes ?? []).some((r) => r.stops.length === 2 && r.caravans === 1), 10000), JSON.stringify(A.routes));
check('caravan view carries its route', await until(() => {
  const cv = A.ents.get(caravan.id);
  return cv?.trade != null && cv.trade.route === A.routes?.[0]?.id;
}, 10000));
check('B receives no routes roster for A’s route', (B.routes ?? []).length === 0);

// Gold lands when the caravan reaches the foreign stop (leg-length scaled).
// Spawns sit 200+ tiles apart and rivers force detours, so give the march
// plenty of rope (at TIME_SCALE=30 a straight 450-tile leg is ~45s real).
const gold0 = A.stock.gold;
const paid = await until(() => A.stock.gold > gold0, 300000, 1000);
check('gold paid on reaching the foreign market', paid, `gold ${gold0} -> ${A.stock.gold}`);

// Deleting the route idles the caravan (its trade view clears).
const routeId = A.routes[0].id;
send(A, { t: 'tradeRoute', action: 'delete', routeId });
check('route deleted from the roster', await until(() => (A.routes ?? []).length === 0, 10000));
check('caravan drops its route view', await until(() => A.ents.get(caravan.id)?.trade == null, 10000));

const failed = results.filter((r) => !r).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
