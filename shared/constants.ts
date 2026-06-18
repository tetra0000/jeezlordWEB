// Core world constants shared by client and server. Pure data — no Node/DOM APIs.

export const TILE = 32; // pixels per tile edge
export const MAP_TILES = 512; // world is MAP_TILES x MAP_TILES tiles
export const MAP_PX = MAP_TILES * TILE; // 16384 px

// Per-tile terrain codes (one byte per tile in World.terrain). Grass is the
// default/passable ground; water is impassable; a bridge sits over water and is
// passable like grass. Terrain is static map geography — generated once, then
// persisted and shipped to the client for rendering + pathing.
export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_BRIDGE = 2;

export const TICK_HZ = 10; // authoritative simulation rate
export const TICK_MS = 1000 / TICK_HZ;

// Server broadcasts state at this rate (<= TICK_HZ). v0 sends every tick.
export const SNAPSHOT_HZ = 10;

// WebSocket heartbeat: server pings every PING_MS, drops a socket with no pong
// within PONG_TIMEOUT_MS.
export const PING_MS = 15_000;
export const PONG_TIMEOUT_MS = 30_000;

// Persistence: flush dirty state to SQLite this often.
export const FLUSH_MS = 30_000;

// v0 movement tuning (px/s). Deliberately slow per the multi-day pacing goal.
export const VILLAGER_SPEED = 60;

// Distance (px) within which a unit is considered "arrived" at its target.
export const ARRIVE_EPSILON = 2;
