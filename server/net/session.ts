// Per-connection session state + the shared game context, plus auth handlers
// (register / login / resume). A socket is unauthenticated until `playerId` is
// bound; dispatch refuses game commands until then.
import type { WebSocket } from 'ws';
import { encode, type ServerMsg } from '../../shared/protocol.js';
import type { EntityId, EntityView, PlayerId, Pop, Stockpile } from '../../shared/types.js';
import { MAP_TILES, TILE, TERRAIN_GRASS, TERRAIN_DIRT, TERRAIN_FLOWERS, TERRAIN_LONGGRASS } from '../../shared/constants.js';
import { encodeTerrainRLE } from '../../shared/terrain.js';
import { BUILDING_STATS, ROAD_LEVELS } from '../../shared/stats.js';
import type { Db } from '../db/db.js';
import type { World } from '../sim/world.js';
import type { GameLoop } from '../sim/loop.js';
import { hashPassword, newToken, verifyPassword } from '../auth/password.js';
import { spawnBuilding, spawnResourceNode, spawnUnit } from '../sim/spawn.js';
import { removeResourceNode } from '../sim/systems/gather.js';
import { killEntity } from '../sim/systems/combat.js';
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
  lastJobs = '';
  lastMarket = ''; // last market-price key sent (so we only resend on change)
  lastDefeated = false; // last defeat state sent (sent only when it flips)
  lastDiplo = ''; // last diplomacy-roster key sent (so we only resend on change)
  lastRoutes = ''; // last trade-routes key sent (so we only resend on change)

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

// A spawn needs open ground: the whole starting area (town center footprint plus
// the cleared resource ring) must be dry grass, well away from any river.
const SPAWN_DRY_RADIUS = 7; // tiles around the spawn that must be water-free
function spawnAreaDry(world: World, x: number, y: number): boolean {
  for (let dy = -SPAWN_DRY_RADIUS; dy <= SPAWN_DRY_RADIUS; dy++)
    for (let dx = -SPAWN_DRY_RADIUS; dx <= SPAWN_DRY_RADIUS; dx++) {
      const t = world.terrainAt(x + dx, y + dy);
      // Grass-like cosmetic ground (dirt patches, flower meadows, long grass)
      // is fine too; swamp/rocks/mountain passes are not spawn ground.
      if (t !== TERRAIN_GRASS && t !== TERRAIN_DIRT && t !== TERRAIN_FLOWERS && t !== TERRAIN_LONGGRASS) return false;
    }
  return true;
}

// Pick a spawn tile >= MIN_SPAWN_DIST from every existing player's spawn, on dry
// land. Random sampling with a best-effort fallback (max-min distance) if the
// map is crowded; the fallback still prefers dry candidates.
function findSpawnTile(world: World): { x: number; y: number } {
  const existing = [...world.players.values()].map((p) => ({ x: p.spawnTileX, y: p.spawnTileY }));
  const lo = SPAWN_EDGE_MARGIN;
  const hi = MAP_TILES - SPAWN_EDGE_MARGIN;
  let best = { x: Math.floor(MAP_TILES / 2), y: Math.floor(MAP_TILES / 2) };
  let bestMin = -1;
  for (let i = 0; i < 600; i++) {
    const x = lo + Math.floor(Math.random() * (hi - lo));
    const y = lo + Math.floor(Math.random() * (hi - lo));
    if (!spawnAreaDry(world, x, y)) continue;
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
  // A starting scout cavalry squad: fast, far-seeing, for early exploration.
  spawnUnit(world, 'scoutCavalry', playerId, baseX + STARTING_VILLAGERS * TILE, baseY);
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
      jobDesired: {},
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
      jobDesired: ctx.db.getPlayerJobs(row.id),
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

  session.send({ t: 'authOk', token, playerId, username: user.username });
  sendInit(ctx, session, playerId);

  // Admin mode is in-memory on the server and survives reconnects — re-sync the
  // client so its cheat panel / fog reveal come back after a refresh.
  if (ctx.world.admin.has(playerId)) {
    session.send({
      t: 'adminState',
      enabled: true,
      reveal: ctx.world.adminReveal.has(playerId),
    });
  }
}

// Send the world init (map + the player's stockpile/pop) and reset the session's
// diff baselines so the next delta re-sends their whole visible set. Used on bind
// (reconnect) and again on a defeat restart.
function sendInit(ctx: GameContext, session: Session, playerId: PlayerId): void {
  const p = ctx.world.players.get(playerId)!;
  const pop: Pop = { used: ctx.world.popUsed(playerId), cap: ctx.world.popCap(playerId) };
  // Full caravan-road-wear snapshot (quantised); increments then arrive in deltas.
  const roads: Array<[number, number]> = [];
  for (const [tile, wear] of ctx.world.roadWear) {
    const lvl = Math.round(wear * ROAD_LEVELS);
    if (lvl > 0) roads.push([tile, lvl]);
  }
  session.send({
    t: 'init',
    playerId,
    mapTiles: MAP_TILES,
    tile: TILE,
    stockpile: { ...p.stockpile },
    pop,
    terrain: encodeTerrainRLE(ctx.world.terrain),
    roads: roads.length > 0 ? roads : undefined,
  });
  session.lastSent.clear();
  session.lastStockpile = { ...p.stockpile };
  session.lastPop = { ...pop };
  session.lastJobs = '';
  session.lastMarket = '';
  session.lastDefeated = false;
  session.lastDiplo = '';
  session.lastRoutes = '';
}

// Defeat restart: wipe everything the player still owns, reset their economy and
// fog memory, then re-seed them at a fresh far-away spawn and re-init the client.
// The caller (dispatch) has already verified the player is actually defeated.
export function restartPlayer(ctx: GameContext, session: Session, playerId: PlayerId): void {
  const world = ctx.world;
  const owned: EntityId[] = [];
  for (const [id, owner] of world.owner) if (owner === playerId) owned.push(id);
  for (const id of owned) killEntity(world, id); // buildings only (0 units = defeated)

  const p = world.players.get(playerId)!;
  p.stockpile = { ...STARTING_STOCKPILE };
  p.jobDesired = {};
  world.markPlayerDirty(playerId);
  world.discoveredResources.delete(playerId);
  world.discoveredMarkets.delete(playerId);

  // Trade routes don't survive a defeat: the player's routes are dissolved
  // (their caravans died with them; other players' routes are untouched).
  for (const [rid, route] of world.tradeRoutes) {
    if (route.owner === playerId) {
      world.tradeRoutes.delete(rid);
      world.routesDirty = true;
    }
  }

  // A fresh life starts diplomatically clean: every relation and pending offer
  // involving this player reverts to neutral (old wars don't follow them).
  for (const key of [...world.relations.keys(), ...world.diploOffers.keys()]) {
    const [a, b] = key.split(':').map(Number);
    if (a === playerId || b === playerId) {
      world.relations.delete(key);
      world.diploOffers.delete(key);
      world.diploDirty = true;
    }
  }

  const spawn = findSpawnTile(world);
  p.spawnTileX = spawn.x;
  p.spawnTileY = spawn.y;
  ctx.db.setPlayerSpawn(playerId, spawn.x, spawn.y);
  setupNewPlayer(world, playerId, spawn.x, spawn.y);

  sendInit(ctx, session, playerId);
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
