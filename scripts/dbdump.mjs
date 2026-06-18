// Waits for one persistence flush interval, then dumps persisted rows so we can
// verify the world reached SQLite. Usage: node scripts/dbdump.mjs [waitMs]
import { DatabaseSync } from 'node:sqlite';

const waitMs = Number(process.argv[2] ?? 0);
await new Promise((r) => setTimeout(r, waitMs));

const db = new DatabaseSync('data/world.db');
const users = db.prepare('SELECT id, username FROM users').all();
const players = db.prepare('SELECT id, name, spawn_tile_x, spawn_tile_y FROM players').all();
const entities = db.prepare('SELECT id, kind, owner_player_id, round(x) x, round(y) y, hp FROM entities').all();
const moves = db.prepare('SELECT entity_id, round(target_x) tx, round(target_y) ty FROM ent_movement').all();
const meta = db.prepare("SELECT k, v FROM world_meta").all();

console.log('users   :', JSON.stringify(users));
console.log('players :', JSON.stringify(players));
console.log('entities:', JSON.stringify(entities));
console.log('movement:', JSON.stringify(moves));
console.log('meta    :', JSON.stringify(meta));
db.close();
