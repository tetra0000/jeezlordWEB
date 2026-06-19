// Verifies the market: build one, then sell wood for gold and buy stone with
// gold; prices move with trades and the server reprices live. Uses admin boost
// so resource math is independent of how many markets the probe placed.
// Run with TIME_SCALE=30.
import WebSocket from 'ws';

const TILE = 32;
const user = 'market_' + Math.floor(Date.now() % 100000);
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1;
let stock = { wood: 0, gold: 0, food: 0, stone: 0 };
let market = null;
const rejects = [];
const send = (m) => ws.send(JSON.stringify(m));
const own = (kind) => [...ents.values()].filter((e) => e.owner === pid && e.kind === kind);

ws.on('open', () => send({ t: 'register', username: user, password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(1); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'init') stock = m.stockpile;
  else if (m.t === 'reject') rejects.push(m.reason);
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e); // full view each update (like the client)
    for (const id of (m.leave ?? [])) ents.delete(id);
    if (m.you) Object.assign(stock, m.you);
    if (m.market) market = m.market;
  }
});

const results = [];
const check = (n, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${n} ${extra}`); };

// 1) Enable admin + boost resources (so trades aren't limited by build costs).
setTimeout(() => {
  const tc = own('townCenter')[0];
  send({ t: 'rename', buildingId: tc.id, name: 'adminmode' });
}, 1500);
setTimeout(() => send({ t: 'admin', action: 'boostResources' }), 2800);

// 2) Place a market inside territory (probe a few spots so a stray node doesn't block).
setTimeout(() => {
  const tc = own('townCenter')[0];
  const tcx = Math.round(tc.x / TILE), tcy = Math.round(tc.y / TILE);
  for (const [dx, dy] of [[-5, -2], [5, -2], [-2, 5], [5, 2], [-6, 1], [2, 6]])
    send({ t: 'build', kind: 'market', tileX: tcx + dx, tileY: tcy + dy });
}, 3200);

// 3) Wait for a builder to finish a market, then trade.
let woodBefore, goldBeforeSell, goldBeforeBuy, stoneBefore;
setTimeout(() => {
  check('received live market prices', !!market, `market=${JSON.stringify(market)}`);
  woodBefore = stock.wood;
  goldBeforeSell = stock.gold;
  send({ t: 'market', action: 'sell', resource: 'wood', amount: 100 });
}, 12000);

setTimeout(() => {
  check('selling wood reduced wood by 100', stock.wood === woodBefore - 100, `wood ${woodBefore} -> ${stock.wood}`);
  check('selling wood added gold', stock.gold > goldBeforeSell, `gold ${goldBeforeSell} -> ${stock.gold}`);
  check('selling pushed the wood price below baseline', market && market.wood < 1, `wood mult=${market?.wood}`);
  goldBeforeBuy = stock.gold;
  stoneBefore = stock.stone;
  send({ t: 'market', action: 'buy', resource: 'stone', amount: 100 });
}, 13500);

setTimeout(() => {
  check('buying stone added 100 stone', stock.stone === stoneBefore + 100, `stone ${stoneBefore} -> ${stock.stone}`);
  check('buying stone spent gold', stock.gold < goldBeforeBuy, `gold ${goldBeforeBuy} -> ${stock.gold}`);
  check('buying pushed the stone price above baseline', market && market.stone > 1, `stone mult=${market?.stone}`);
  check('an operational market exists (trades succeeded against it)', own('market').some((e) => e.build == null) && !rejects.some((r) => /market first/i.test(r)),
    `markets=${own('market').length} rejects=${JSON.stringify(rejects)}`);
  const failed = results.filter((c) => !c).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}, 15000);
