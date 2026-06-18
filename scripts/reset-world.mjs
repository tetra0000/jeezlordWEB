// Dev-only: wipe the persistent world (accounts, players, entities, and the
// seeded map) so the next `npm start` boots a fresh world and regenerates the
// map. Deletes the SQLite file plus its WAL/SHM sidecars. Honours DB_PATH the
// same way server/main.ts does. Stop the server first — node:sqlite holds the
// file open while running.
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'world.db');
const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];

let removed = 0;
for (const f of targets) {
  try {
    rmSync(f, { force: true });
    removed++;
  } catch (err) {
    console.error(`[reset] could not remove ${f}:`, err.message);
  }
}

console.log(`[reset] wiped world at ${dbPath} (${removed} file(s) cleared).`);
console.log('[reset] next `npm start` will reseed a fresh map.');
