// SQLite schema. Idempotent CREATE TABLE statements + a schema version in
// world_meta for future hand-written migrations. v0 persists users, sessions,
// players, stockpiles and entities (with a movement sidecar).
import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT UNIQUE NOT NULL,
      pw_hash    TEXT NOT NULL,
      pw_salt    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER UNIQUE NOT NULL,
      name         TEXT NOT NULL,
      color        INTEGER NOT NULL,
      spawn_tile_x INTEGER NOT NULL,
      spawn_tile_y INTEGER NOT NULL,
      created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stockpiles (
      player_id INTEGER PRIMARY KEY,
      wood      INTEGER NOT NULL DEFAULT 0,
      gold      INTEGER NOT NULL DEFAULT 0,
      food      INTEGER NOT NULL DEFAULT 0,
      stone     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS entities (
      id              INTEGER PRIMARY KEY,
      kind            TEXT NOT NULL,
      owner_player_id INTEGER,
      x               REAL NOT NULL,
      y               REAL NOT NULL,
      hp              REAL NOT NULL,
      max_hp          REAL NOT NULL
    );

    -- Movement sidecar: we persist the target (not the full path); paths are
    -- recomputed on load. NULL target means idle.
    CREATE TABLE IF NOT EXISTS ent_movement (
      entity_id INTEGER PRIMARY KEY,
      speed     REAL NOT NULL,
      target_x  REAL,
      target_y  REAL
    );

    -- Villager gathering state.
    CREATE TABLE IF NOT EXISTS ent_gather (
      entity_id  INTEGER PRIMARY KEY,
      state      TEXT NOT NULL,
      carrying   REAL NOT NULL,
      carry_type TEXT,
      node_id    INTEGER
    );

    -- Building construction progress.
    CREATE TABLE IF NOT EXISTS ent_construct (
      entity_id  INTEGER PRIMARY KEY,
      build_time REAL NOT NULL,
      elapsed    REAL NOT NULL,
      complete   INTEGER NOT NULL
    );

    -- Production building training queue (small JSON array).
    CREATE TABLE IF NOT EXISTS ent_train (
      entity_id  INTEGER PRIMARY KEY,
      queue_json TEXT NOT NULL
    );

    -- Remaining harvestable amount for resource nodes.
    CREATE TABLE IF NOT EXISTS resource_nodes (
      entity_id INTEGER PRIMARY KEY,
      amount    REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);

  // Stamp / verify schema version.
  const row = db
    .prepare(`SELECT v FROM world_meta WHERE k = 'schema_version'`)
    .get() as { v: string } | undefined;
  if (!row) {
    db.prepare(`INSERT INTO world_meta (k, v) VALUES ('schema_version', ?)`).run(
      String(SCHEMA_VERSION),
    );
  }
}
