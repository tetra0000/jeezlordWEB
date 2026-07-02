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

    -- Villager gathering state (incl. the assigned job since v8).
    CREATE TABLE IF NOT EXISTS ent_gather (
      entity_id  INTEGER PRIMARY KEY,
      state      TEXT NOT NULL,
      carrying   REAL NOT NULL,
      carry_type TEXT,
      node_id    INTEGER,
      job        TEXT NOT NULL DEFAULT 'builder'
    );

    -- Per-player desired villager count for each non-builder job (v8).
    CREATE TABLE IF NOT EXISTS player_jobs (
      player_id INTEGER NOT NULL,
      job       TEXT NOT NULL,
      count     INTEGER NOT NULL,
      PRIMARY KEY (player_id, job)
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

    -- Production building rally point (where trained units walk on spawn).
    CREATE TABLE IF NOT EXISTS ent_rally (
      entity_id INTEGER PRIMARY KEY,
      x         REAL NOT NULL,
      y         REAL NOT NULL
    );

    -- Per-building extras: town-center name + territory radius, farm reseed
    -- flag, gate mode. Columns are nullable; which apply depends on the kind.
    CREATE TABLE IF NOT EXISTS ent_building_meta (
      entity_id INTEGER PRIMARY KEY,
      name      TEXT,
      radius    REAL,
      farm_auto INTEGER,
      gate_mode TEXT
    );

    -- Caravan road wear per tile (cosmetic ground state, 0..1). Sparse: only
    -- tiles caravans have actually worn.
    CREATE TABLE IF NOT EXISTS road_wear (
      tile INTEGER PRIMARY KEY,
      wear REAL NOT NULL
    );

    -- Caravan route assignments (which trade route, which stop is next, and the
    -- stop last departed — the leg-length basis for the next payout). The
    -- legacy home_id/target_id columns are from the pre-routes system (v11) and
    -- are no longer read.
    CREATE TABLE IF NOT EXISTS ent_trade (
      entity_id  INTEGER PRIMARY KEY,
      state      TEXT NOT NULL,
      home_id    INTEGER,
      target_id  INTEGER,
      route_id   INTEGER,
      stop_index INTEGER,
      last_stop  INTEGER
    );

    -- Trade routes: an owned, ordered loop of market stops (JSON array of
    -- entity ids) that caravans are assigned to.
    CREATE TABLE IF NOT EXISTS trade_routes (
      id         INTEGER PRIMARY KEY,
      owner      INTEGER NOT NULL,
      stops_json TEXT NOT NULL
    );

    -- Military squad stance (aggressive/defensive/standGround/noAttack).
    CREATE TABLE IF NOT EXISTS ent_stance (
      entity_id INTEGER PRIMARY KEY,
      stance    TEXT NOT NULL
    );

    -- Remaining harvestable amount for resource nodes.
    CREATE TABLE IF NOT EXISTS resource_nodes (
      entity_id INTEGER PRIMARY KEY,
      amount    REAL NOT NULL
    );

    -- Corpses: the unit kind that died (sprite), original owner (team colour),
    -- and decay age in sim-seconds. The base entity row carries position.
    CREATE TABLE IF NOT EXISTS ent_corpse (
      entity_id INTEGER PRIMARY KEY,
      unit_kind TEXT NOT NULL,
      team      INTEGER,
      age       REAL NOT NULL
    );

    -- Diplomacy: relation per player pair (a < b), plus the pending step-up
    -- proposal's proposer (NULL if none). Neutral pairs have no row.
    CREATE TABLE IF NOT EXISTS diplomacy (
      a        INTEGER NOT NULL,
      b        INTEGER NOT NULL,
      state    TEXT NOT NULL,
      proposer INTEGER,
      PRIMARY KEY (a, b)
    );

    CREATE TABLE IF NOT EXISTS world_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);

  // v8 migration: add ent_gather.job to databases created before villager jobs.
  // (CREATE TABLE IF NOT EXISTS won't add a column to an existing table.)
  const gatherCols = db.prepare(`PRAGMA table_info(ent_gather)`).all() as Array<{ name: string }>;
  if (!gatherCols.some((c) => c.name === 'job')) {
    db.exec(`ALTER TABLE ent_gather ADD COLUMN job TEXT NOT NULL DEFAULT 'builder'`);
  }

  // v12 migration: add ent_building_meta.gate_mode to pre-gates databases.
  const metaCols = db.prepare(`PRAGMA table_info(ent_building_meta)`).all() as Array<{ name: string }>;
  if (!metaCols.some((c) => c.name === 'gate_mode')) {
    db.exec(`ALTER TABLE ent_building_meta ADD COLUMN gate_mode TEXT`);
  }

  // v13 migration: add the trade-route columns to a pre-routes ent_trade table.
  // Old home/target shuttles are not migrated — those caravans simply go idle.
  const tradeCols = db.prepare(`PRAGMA table_info(ent_trade)`).all() as Array<{ name: string }>;
  if (!tradeCols.some((c) => c.name === 'route_id')) {
    db.exec(`ALTER TABLE ent_trade ADD COLUMN route_id INTEGER`);
    db.exec(`ALTER TABLE ent_trade ADD COLUMN stop_index INTEGER`);
    db.exec(`ALTER TABLE ent_trade ADD COLUMN last_stop INTEGER`);
  }

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
