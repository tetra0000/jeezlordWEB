// v5 (combat) + v6 (fog of war / anti-cheat) verification with two players.
// Asserts: (1) at spawn, A cannot see B's entities (out of vision); (2) when
// armies converge, A starts receiving B's entities (vision reveal); (3) combat
// damages/kills units. Run against a fast-forwarded server (TIME_SCALE=30).
import WebSocket from 'ws';

const stamp = Math.floor(Date.now() % 100000);

function client(name) {
  const ws = new WebSocket('ws://localhost:8081/ws');
  const c = { name, ws, pid: -1, ents: new Map(), sawEnemy: false, damageSeen: false, deaths: 0, ready: null };
  c.ready = new Promise((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', username: `${name}_${stamp}`, password: 'hunter2' })));
    ws.on('error', (e) => { console.error(name, 'ws', e.message); process.exit(1); });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'authOk') c.pid = m.playerId;
      else if (m.t === 'init') resolve();
      else if (m.t === 'reject') console.error(name, 'REJECT', m.reason);
      else if (m.t === 'delta') {
        for (const e of m.enter) {
          c.ents.set(e.id, e);
          if (e.owner != null && e.owner !== c.pid) c.sawEnemy = true;
        }
        for (const e of m.update) {
          c.ents.set(e.id, e);
          if (e.hp < e.maxHp && (e.owner != null)) c.damageSeen = true;
        }
        for (const id of m.leave) { if (c.ents.has(id)) c.deaths++; c.ents.delete(id); }
      }
    });
  });
  return c;
}

const own = (c, kind) => [...c.ents.values()].filter((e) => e.owner === c.pid && (!kind || e.kind === kind));
const send = (c, m) => c.ws.send(JSON.stringify(m));
const results = [];
const check = (n, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}: ${n} ${extra}`); };

const A = client('atk');
const B = client('def');

await Promise.all([A.ready, B.ready]);
await new Promise((r) => setTimeout(r, 600)); // let first deltas arrive

// (1) Anti-cheat: A must not see any of B's entities at spawn.
const enemyAtSpawn = [...A.ents.values()].filter((e) => e.owner != null && e.owner !== A.pid);
check('anti-cheat: A cannot see B at spawn', enemyAtSpawn.length === 0, `saw ${enemyAtSpawn.length}`);
check('A and B are distinct players', A.pid !== B.pid && A.pid > 0 && B.pid > 0, `pids ${A.pid},${B.pid}`);

// Diplomacy: players start NEUTRAL and cannot fight until war is declared.
// B declares war on A (unilateral + immediate), which also exercises the
// diplomacy intent end-to-end.
send(B, { t: 'diplomacy', action: 'declareWar', playerId: A.pid });
await new Promise((r) => setTimeout(r, 400));

// (2)+(3): A holds in its open, cleared base and auto-defends; B marches its
// whole army onto A's position and attacks. One side stationary avoids the
// equal-speed mutual-chase that can prevent slow units from ever meleeing.
A.sawEnemy = false;
const a0 = own(A)[0]; // A's base location (open ground)
const visibleEnemy = (c) => [...c.ents.values()].find((e) => e.owner != null && e.owner !== c.pid);

send(B, { t: 'move', unitIds: own(B).map((e) => e.id), x: a0.x, y: a0.y });
// Single driver: if B can see an A unit, focus-fire it (re-target only when it
// dies); otherwise keep marching toward A's base. Avoids move/attack conflict.
const engage = setInterval(() => {
  const foe = visibleEnemy(B);
  if (foe) {
    if (B.curTarget != null && B.ents.has(B.curTarget)) return; // already engaging a live foe
    B.curTarget = foe.id;
    send(B, { t: 'attack', unitIds: own(B).map((e) => e.id), targetId: foe.id });
  } else {
    send(B, { t: 'move', unitIds: own(B).map((e) => e.id), x: a0.x, y: a0.y });
  }
}, 1500);

await new Promise((r) => setTimeout(r, 65000)); // worst-case far-spawn traverse + open-ground fight
clearInterval(engage);

check('fog reveal: A sees B once armies converge', A.sawEnemy, `seen=${A.sawEnemy}`);
check('combat dealt damage', A.damageSeen || B.damageSeen, `A=${A.damageSeen} B=${B.damageSeen}`);
check('combat killed unit(s)', A.deaths + B.deaths > 0, `deaths A=${A.deaths} B=${B.deaths}`);

const failed = results.filter((r) => !r).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
