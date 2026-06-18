// Thin wrapper over node:sqlite's DatabaseSync: opens the file in WAL mode,
// initialises the schema, and exposes prepared statements for auth + persistence.
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from './schema.js';
import type { EntityKind, Stockpile, VillagerJob } from '../../shared/types.js';

export interface UserRow {
  id: number;
  username: string;
  pw_hash: string;
  pw_salt: string;
}

export interface PlayerRow {
  id: number;
  user_id: number;
  name: string;
  color: number;
  spawn_tile_x: number;
  spawn_tile_y: number;
}

export interface EntityRow {
  id: number;
  kind: EntityKind;
  owner_player_id: number | null;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
}

export interface MovementRow {
  entity_id: number;
  speed: number;
  target_x: number | null;
  target_y: number | null;
}

export class Db {
  readonly handle: DatabaseSync;

  constructor(path: string) {
    this.handle = new DatabaseSync(path);
    this.handle.exec('PRAGMA journal_mode = WAL;');
    this.handle.exec('PRAGMA synchronous = NORMAL;');
    this.handle.exec('PRAGMA foreign_keys = ON;');
    initSchema(this.handle);
  }

  close(): void {
    this.handle.close();
  }

  // --- meta -----------------------------------------------------------------
  getMeta(key: string): string | undefined {
    const row = this.handle
      .prepare('SELECT v FROM world_meta WHERE k = ?')
      .get(key) as { v: string } | undefined;
    return row?.v;
  }

  setMeta(key: string, value: string): void {
    this.handle
      .prepare('INSERT OR REPLACE INTO world_meta (k, v) VALUES (?, ?)')
      .run(key, value);
  }

  // --- users ----------------------------------------------------------------
  getUserByUsername(username: string): UserRow | undefined {
    return this.handle
      .prepare('SELECT id, username, pw_hash, pw_salt FROM users WHERE username = ?')
      .get(username) as UserRow | undefined;
  }

  getUserById(id: number): UserRow | undefined {
    return this.handle
      .prepare('SELECT id, username, pw_hash, pw_salt FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;
  }

  createUser(username: string, hash: string, salt: string, now: number): number {
    const info = this.handle
      .prepare(
        'INSERT INTO users (username, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(username, hash, salt, now);
    return Number(info.lastInsertRowid);
  }

  // --- sessions -------------------------------------------------------------
  createSession(token: string, userId: number, now: number): void {
    this.handle
      .prepare(
        'INSERT OR REPLACE INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)',
      )
      .run(token, userId, now, now);
  }

  getSessionUser(token: string): number | undefined {
    const row = this.handle
      .prepare('SELECT user_id FROM sessions WHERE token = ?')
      .get(token) as { user_id: number } | undefined;
    return row?.user_id;
  }

  touchSession(token: string, now: number): void {
    this.handle.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now, token);
  }

  // --- players --------------------------------------------------------------
  getPlayerByUserId(userId: number): PlayerRow | undefined {
    return this.handle
      .prepare(
        'SELECT id, user_id, name, color, spawn_tile_x, spawn_tile_y FROM players WHERE user_id = ?',
      )
      .get(userId) as PlayerRow | undefined;
  }

  createPlayer(
    userId: number,
    name: string,
    color: number,
    spawnX: number,
    spawnY: number,
    now: number,
  ): number {
    const info = this.handle
      .prepare(
        `INSERT INTO players (user_id, name, color, spawn_tile_x, spawn_tile_y, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, name, color, spawnX, spawnY, now);
    return Number(info.lastInsertRowid);
  }

  getStockpile(playerId: number): Stockpile | undefined {
    return this.handle
      .prepare('SELECT wood, gold, food, stone FROM stockpiles WHERE player_id = ?')
      .get(playerId) as Stockpile | undefined;
  }

  upsertStockpile(playerId: number, s: Stockpile): void {
    this.handle
      .prepare(
        `INSERT OR REPLACE INTO stockpiles (player_id, wood, gold, food, stone)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(playerId, s.wood, s.gold, s.food, s.stone);
  }

  // Desired villager count per non-builder job (empty for a fresh player).
  getPlayerJobs(playerId: number): Partial<Record<VillagerJob, number>> {
    const rows = this.handle
      .prepare('SELECT job, count FROM player_jobs WHERE player_id = ?')
      .all(playerId) as Array<{ job: string; count: number }>;
    const out: Partial<Record<VillagerJob, number>> = {};
    for (const r of rows) out[r.job as VillagerJob] = r.count;
    return out;
  }

  // --- entities (bulk load for boot) ---------------------------------------
  allEntities(): EntityRow[] {
    return this.handle
      .prepare('SELECT id, kind, owner_player_id, x, y, hp, max_hp FROM entities')
      .all() as unknown as EntityRow[];
  }

  allMovement(): MovementRow[] {
    return this.handle
      .prepare('SELECT entity_id, speed, target_x, target_y FROM ent_movement')
      .all() as unknown as MovementRow[];
  }
}
