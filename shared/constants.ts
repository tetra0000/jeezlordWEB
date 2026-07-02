// Core world constants shared by client and server. Pure data — no Node/DOM APIs.

export const TILE = 32; // pixels per tile edge
export const MAP_TILES = 768; // world is MAP_TILES x MAP_TILES tiles
export const MAP_PX = MAP_TILES * TILE; // 24576 px

// Per-tile terrain codes (one byte per tile in World.terrain). Grass is the
// default/passable ground; water is impassable; a bridge sits over water and is
// passable like grass. Terrain is static map geography — generated once, then
// persisted and shipped to the client for rendering + pathing.
export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_BRIDGE = 2;
// Mountains are static, impassable terrain (like water) — generated as ranges
// with deliberate walkable passes carved through. Rendered as a rocky tile.
export const TERRAIN_MOUNTAIN = 3;
// Mud lines river banks; beach appears at scattered shoreline points. Both are
// purely cosmetic ground — PASSABLE exactly like grass (only water/mountain
// block). New tiles in v10's terrain-variety pass.
export const TERRAIN_MUD = 4;
export const TERRAIN_BEACH = 5;
// More cosmetic ground variety: dry dirt patches and flower meadows, scattered
// as organic blobs across the grassland. PASSABLE exactly like grass.
export const TERRAIN_DIRT = 6;
export const TERRAIN_FLOWERS = 7;
// Long grass: tall meadow blobs on open grassland. Passable, cosmetic.
export const TERRAIN_LONGGRASS = 8;
// Swamp: boggy lowland near water. PASSABLE but debuffed — units move at
// SWAMP_SPEED_MULT and fight at SWAMP_ATTACK_MULT while standing in it
// (see shared/stats.ts; applied in movement.ts / combat.ts).
export const TERRAIN_SWAMP = 9;
// Rocky scree: small scattered rock outcrops for ground variety. Passable.
export const TERRAIN_ROCKS = 10;
// Mountain pass: the walkable rocky floor of a pass punched through a range —
// reads as bare rock, not grass. Passable exactly like grass.
export const TERRAIN_PASS = 11;

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
