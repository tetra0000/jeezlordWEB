// Verify unit deletion: a deleted own unit is removed, population drops, and NO
// resources are refunded. Run against a running server.
import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:8081/ws');
const ents = new Map();
let pid = -1, stock = null, pop = null;
const send = (m) => ws.send(JSON.stringify(m));
const own = () => [...ents.values()].filter((e) => e.owner === pid && e.kind !== 'townCenter'
  && !['tree','gold','stone','berry'].includes(e.kind) && e.x != null);
const ownUnits = () => [...ents.values()].filter((e) => e.owner === pid
  && ['villager','scoutCavalry','warrior','archer','knight','horseArcher','catapult'].includes(e.kind));
const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

ws.on('open', () => send({ t: 'register', username: 'del_' + Math.floor(Date.now() % 100000), password: 'hunter2' }));
ws.on('error', (e) => { console.error('ws', e.message); process.exit(2); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'authOk') pid = m.playerId;
  else if (m.t === 'init') { stock = m.stockpile; pop = m.pop; }
  else if (m.t === 'reject') console.error('REJECT', m.reason);
  else if (m.t === 'delta') {
    for (const e of m.enter) ents.set(e.id, e);
    for (const e of m.update) ents.set(e.id, e);
    for (const id of m.leave) ents.delete(id);
    if (m.you) Object.assign(stock, m.you);
    if (m.pop) pop = m.pop;
  }
});

await new Promise((r) => setTimeout(r, 1500));
const before = ownUnits();
const stockBefore = { ...stock };
const popBefore = pop.used;
check('has starting units to delete', before.length >= 2, `units=${before.length}`);
const victims = before.slice(0, 2).map((e) => e.id);
send({ t: 'delete', unitIds: victims });
await new Promise((r) => setTimeout(r, 1500));
const after = ownUnits();
check('units removed', after.length === before.length - 2, `${before.length} -> ${after.length}`);
check('deleted units gone from world', victims.every((id) => !ents.has(id)));
check('population dropped', pop.used === popBefore - 2, `${popBefore} -> ${pop.used}`);
check('NO resource refund', JSON.stringify(stock) === JSON.stringify(stockBefore),
  `${JSON.stringify(stockBefore)} -> ${JSON.stringify(stock)}`);
const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
