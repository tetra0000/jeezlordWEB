// Entrypoint: open the DB, rebuild the world, start the static file server +
// WebSocket server + 10 Hz game loop + periodic persistence. Traps SIGTERM /
// SIGINT for a final flush so deploys/restarts lose at most one flush interval.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { FLUSH_MS } from '../shared/constants.js';
import { Db } from './db/db.js';
import { loadWorld } from './db/load.js';
import { flush } from './db/persist.js';
import { World } from './sim/world.js';
import { seedWorld } from './sim/worldgen.js';
import { GameLoop } from './sim/loop.js';
import { WsServer } from './net/wsServer.js';
import type { GameContext, Session } from './net/session.js';
import type { PlayerId } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 8081);
const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'world.db');
const CLIENT_DIR = join(process.cwd(), 'client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Minimal static file server for the client (in production nginx serves these
// directly and only proxies /ws; serving them here is harmless and enables
// single-command local dev).
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // Prevent path traversal.
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(CLIENT_DIR, safe);
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

function main(): void {
  const db = new Db(DB_PATH);
  const world = new World();
  loadWorld(db, world);
  console.log(
    `[main] loaded ${[...world.entityIds()].length} entities, ${world.players.size} players`,
  );

  // One-time world generation on a fresh world.
  if (db.getMeta('seeded') !== '1') {
    seedWorld(world);
    // Persist the static terrain grid as a base64 blob (written once).
    db.setMeta('terrain', Buffer.from(world.terrain).toString('base64'));
    db.setMeta('seeded', '1');
    flush(db, world);
  }

  const online = new Map<PlayerId, Session>();

  const httpServer = createServer((req, res) => {
    void serveStatic(req, res);
  });

  let ws: WsServer;
  const loop = new GameLoop(world, (tick) => {
    ws.broadcast(tick);
  });

  const ctx: GameContext = { db, world, loop, online };
  ws = new WsServer(httpServer, ctx);

  httpServer.listen(PORT, () => {
    console.log(`[main] http+ws listening on :${PORT} (db: ${DB_PATH})`);
  });

  loop.start();

  const flushTimer = setInterval(() => {
    try {
      flush(db, world);
    } catch (err) {
      console.error('[persist] flush failed:', err);
    }
  }, FLUSH_MS);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[main] ${signal} received, flushing and shutting down…`);
    clearInterval(flushTimer);
    loop.stop();
    ws.close();
    try {
      flush(db, world);
    } catch (err) {
      console.error('[persist] final flush failed:', err);
    }
    db.close();
    httpServer.close(() => process.exit(0));
    // Safety net if http close hangs.
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
