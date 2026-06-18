// WebSocket client wrapper: connect, auto-reconnect with backoff, and resume an
// existing session via the stored token. Decodes server messages and forwards
// them to handlers. The server scheme (ws/wss) follows the page protocol so the
// same build works behind nginx TLS in production.
import { decodeServer, encode, type ClientMsg, type ServerMsg } from '../../shared/protocol.js';

const TOKEN_KEY = 'jeezlord.token';

export interface NetHandlers {
  onMessage: (msg: ServerMsg) => void;
  onStatus: (status: 'connecting' | 'open' | 'closed') => void;
}

export class Net {
  private ws: WebSocket | null = null;
  private backoff = 500;
  private closedByUs = false;

  constructor(private readonly handlers: NetHandlers) {}

  private url(): string {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws`;
  }

  connect(): void {
    this.closedByUs = false;
    this.handlers.onStatus('connecting');
    const ws = new WebSocket(this.url());
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.handlers.onStatus('open');
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) this.send({ t: 'resume', token });
    };

    ws.onmessage = (ev) => {
      const msg = decodeServer(typeof ev.data === 'string' ? ev.data : '');
      if (msg) this.handlers.onMessage(msg);
    };

    ws.onclose = () => {
      this.handlers.onStatus('closed');
      if (!this.closedByUs) this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 10_000);
    setTimeout(() => this.connect(), delay);
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  static saveToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  static clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  static hasToken(): boolean {
    return localStorage.getItem(TOKEN_KEY) != null;
  }
}
