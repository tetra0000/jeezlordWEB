// WebSocket server: connection lifecycle, heartbeat (ping/pong with
// terminate-on-no-pong), message parsing, and the per-tick snapshot broadcast
// to online players. Attaches to an existing http.Server and upgrades on /ws.
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { PING_MS } from '../../shared/constants.js';
import { decodeClient } from '../../shared/protocol.js';
import { dispatch } from './dispatch.js';
import { buildDelta } from './snapshot.js';
import { GameContext, Session } from './session.js';

export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Set<Session>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    httpServer: HttpServer,
    private readonly ctx: GameContext,
  ) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.startHeartbeat();
  }

  private onConnection(ws: WebSocket): void {
    const session = new Session(ws);
    this.sessions.add(session);

    ws.on('pong', () => {
      session.alive = true;
    });

    ws.on('message', (data) => {
      const msg = decodeClient(data.toString());
      if (!msg) return;
      try {
        dispatch(this.ctx, session, msg);
      } catch (err) {
        console.error('[ws] dispatch error:', err);
      }
    });

    ws.on('close', () => {
      this.sessions.delete(session);
      if (session.playerId != null && this.ctx.online.get(session.playerId) === session) {
        this.ctx.online.delete(session.playerId);
      }
    });

    ws.on('error', (err) => {
      console.error('[ws] socket error:', err.message);
    });
  }

  // Detect dead TCP connections: ping every PING_MS; terminate any socket that
  // didn't pong since the last round.
  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      for (const session of this.sessions) {
        if (!session.alive) {
          session.ws.terminate();
          continue;
        }
        session.alive = false;
        try {
          session.ws.ping();
        } catch {
          /* socket already gone */
        }
      }
    }, PING_MS);
  }

  // Called once per tick by the game loop: send each online player their delta.
  broadcast(tick: number): void {
    for (const session of this.ctx.online.values()) {
      const delta = buildDelta(this.ctx.world, session, tick);
      if (delta) session.send(delta);
    }
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const session of this.sessions) session.ws.terminate();
    this.wss.close();
  }
}
