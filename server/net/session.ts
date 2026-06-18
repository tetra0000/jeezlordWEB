// Per-connection session state + the shared game context, plus auth handlers
// (register / login / resume). A socket is unauthenticated until `playerId` is
// bound; dispatch refuses game commands until then.
import type { WebSocket } from 'ws';
import { encode, type ServerMsg } from '../../shared/protocol.js';
import type { EntityId, EntityView, PlayerId, Pop, Stockpile } from '../../shared/types.js';
import { MAP_TILES, TILE } from '../../shared/constants.js';
import { BUILDING_STATS } from '../../shared/stats.js';
import type { Db } from '../db/db.js';
import type { World } from '../sim/world.js';
import type { GameLoop } from '../sim/loop.js';
import { hashPassword, newToken, verifyPassword } from '../auth/password.js';
import { spawnBuilding, spawnResourceNode, spawnUnit } from '../sim/spawn.js';
import { removeResourceNode } from '../sim/systems/gather.js';
import type { EntityKind } from '../../shared/types.js';

export interface GameContext {
  db: Db;
  world: World;
  loop: GameLoop;
  online: Map<PlayerId, Session>; // playerId -> active session
}

export class Session {
  playerId: PlayerId | null = null;
  username = '';
  alive = true;
  // Snapshot diff state: last entity views sent to this client, by id.
  readonly lastSent = new Map<EntityId, EntityView>();
  lastStockpile: Stockpile = { wood: -1, gold: -1, food: -1, stone: -1 };
  lastPop: Pop = { used: -1, cap: -1 };

  constructor(readonly ws: WebSocket) {}

  send(msg: ServerMsg): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(encode(msg));
  }
  reject(reason: string): void {
    this.send({ t: 'reject', reason });
  }
}

const STARTING_STOCKPILE: Stockpile = { wood: 250, gold: 120, food: 250, stone: 120 };
const STARTING_VILLAGERS = 3;

function now(): number {
  return Date.now();
}

// Town Centers spawn at least this many tiles apart, so players start far from
// each other (must scout/march to make contact).
const MIN_SPAWN_DIST = 200; // tiles
const SPAWN_EDGE_MARGIN = 14; // keep clear of the map border

// Pick a spawn tile >= MIN_SPAWN_DIST from every existing player's spawn. Random
// sampling with a best-effort fallback (max-min distance) if the map is crowded.
function findSpawnTile(world: World): { x: number; y: number } {
  const existing = [...world.players.values()].map((p) => ({ x: p.spawnTileX, y: p.spawnTileY }));
  const lo = SPAWN_EDGE_MARGIN;
  const hi = MAP_TILES - SPAWN_EDGE_MARGIN;
  let best = { x: Math.floor(MAP_TILES / 2), y: Math.floor(MAP_TILES / 2) };
  let bestMin = -1;
  for (let i = 0; i < 600; i++) {
    const x = lo + Math.floor(Math.random() * (hi - lo));
    const y = lo + Math.floor(Math.random() * (hi - lo));
    if (existing.length === 0) return { x, y };
    let minD = Infinity;
    for (const e of existing) minD = Math.min(minD, Math.hypot(x - e.x, y - e.y));
    if (minD >= MIN_SPAWN_DIST) return { x, y };
    if (minD > bestMin) {
      bestMin = minD;
      best = { x, y };
    }
  }
  return best; // map too crowded for the full distance — use the farthest spot found
}

// Clear resource nodes around a spawn so the player starts on open ground.
function clearArea(world: World, tileX: number, tileY: number, radius: number): void {
  const toRemove: EntityId[] = [];
  for (const id of world.entityIds()) {
    if (world.owner.get(id) != null) continue;
    if (world.resourceAmount.has(id)) {
      const tf = world.transform.get(id)!;
      const tx = Math.floor(tf.x / TILE);
      const ty = Math.floor(tf.y / TILE);
      if (Math.abs(tx - tileX) <= radius && Math.abs(ty - tileY) <= radius) toRemove.push(id);
    }
  }
  for (const id of toRemove) removeResourceNode(world, id);
}

// Starter resources placed within initial vision so every player can begin
// gathering immediately (offsets are tiles from the house centre).
const STARTER_NODES: Array<[EntityKind, number, number]> = [
  ['tree', 4, -1], ['tree', 4, 0], ['tree', 4, 1], ['tree', 5, 0],
  ['tree', -4, 0], ['tree', -4, 1], ['tree', 0, -4], ['tree', 1, -4],
  ['berry', -3, 3], ['berry', -4, 3],
  ['gold', 3, 3], ['gold', 4, 3],
  ['stone', -3, -3], ['stone', -4, -3],
];

function setupNewPlayer(world: World, playerId: PlayerId, tileX: number, tileY: number): void {
  clearArea(world, tileX, tileY, 6);
  // A starting Town Center: accepts all resources, trains villagers, pop + vision.
  const f = BUILDING_STATS.townCenter.footprint;
  spawnBuilding(world, 'townCenter', playerId, tileX, tileY, false);
  // Villagers just below the Town Center.
  const baseX = (tileX + f / 2) * TILE;
  const baseY = (tileY + f / 2 + 1.5) * TILE;
  for (let i = 0; i < STARTING_VILLAGERS; i++) {
    spawnUnit(world, 'villager', playerId, baseX + (i - 1) * TILE, baseY);
  }
  // Starter resource cluster around the house centre.
  const cx = tileX + Math.floor(f / 2);
  const cy = tileY + Math.floor(f / 2);
  for (const [kind, dx, dy] of STARTER_NODES) {
    const tx = cx + dx;
    const ty = cy + dy;
    if (world.inBounds(tx, ty) && !world.isBlockedTile(tx, ty)) spawnResourceNode(world, kind, tx, ty);
  }
}

function ensurePlayer(ctx: GameContext, userId: number, username: string): PlayerId {
  const row = ctx.db.getPlayerByUserId(userId);
  if (!row) {
    const color = userId;
    const spawn = findSpawnTile(ctx.world);
    const playerId = ctx.db.createPlayer(userId, username, color, spawn.x, spawn.y, now());
    ctx.db.upsertStockpile(playerId, STARTING_STOCKPILE);
    ctx.world.players.set(playerId, {
      id: playerId,
      name: username,
      color,
      spawnTileX: spawn.x,
      spawnTileY: spawn.y,
      stockpile: { ...STARTING_STOCKPILE },
    });
    setupNewPlayer(ctx.world, playerId, spawn.x, spawn.y);
    return playerId;
  }
  if (!ctx.world.players.has(row.id)) {
    const sp = ctx.db.getStockpile(row.id) ?? { wood: 0, gold: 0, food: 0, stone: 0 };
    ctx.world.players.set(row.id, {
      id: row.id,
      name: row.name,
      color: row.color,
      spawnTileX: row.spawn_tile_x,
      spawnTileY: row.spawn_tile_y,
      stockpile: { ...sp },
    });
  }
  return row.id;
}

function bind(ctx: GameContext, session: Session, userId: number, token: string): void {
  const user = ctx.db.getUserById(userId);
  if (!user) {
    session.reject('account not found');
    return;
  }
  const playerId = ensurePlayer(ctx, userId, user.username);

  const prev = ctx.online.get(playerId);
  if (prev && prev !== session) {
    prev.playerId = null;
    prev.ws.close(4000, 'logged in elsewhere');
  }

  session.playerId = playerId;
  session.username = user.username;
  session.lastSent.clear();
  ctx.online.set(playerId, session);

  const p = ctx.world.players.get(playerId)!;
  const pop: Pop = { used: ctx.world.popUsed(playerId), cap: ctx.world.popCap(playerId) };
  session.send({ t: 'authOk', token, playerId, username: user.username });
  session.send({
    t: 'init',
    playerId,
    mapTiles: MAP_TILES,
    tile: TILE,
    stockpile: { ...p.stockpile },
    pop,
  });
  session.lastStockpile = { ...p.stockpile };
  session.lastPop = { ...pop };
}

export function handleRegister(ctx: GameContext, session: Session, username: string, password: string): void {
  username = username.trim();
  if (username.length < 3 || username.length > 20) {
    session.reject('username must be 3-20 characters');
    return;
  }
  if (password.length < 6) {
    session.reject('password must be at least 6 characters');
    return;
  }
  if (ctx.db.getUserByUsername(username)) {
    session.reject('username already taken');
    return;
  }
  const { hash, salt } = hashPassword(password);
  const userId = ctx.db.createUser(username, hash, salt, now());
  const token = newToken();
  ctx.db.createSession(token, userId, now());
  bind(ctx, session, userId, token);
}

export function handleLogin(ctx: GameContext, session: Session, username: string, password: string): void {
  const user = ctx.db.getUserByUsername(username.trim());
  if (!user || !verifyPassword(password, user.pw_hash, user.pw_salt)) {
    session.reject('invalid username or password');
    return;
  }
  const token = newToken();
  ctx.db.createSession(token, user.id, now());
  bind(ctx, session, user.id, token);
}

export function handleResume(ctx: GameContext, session: Session, token: string): void {
  const userId = ctx.db.getSessionUser(token);
  if (userId == null) {
    session.reject('session expired');
    return;
  }
  ctx.db.touchSession(token, now());
  bind(ctx, session, userId, token);
}
