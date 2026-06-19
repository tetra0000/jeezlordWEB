// PixiJS application + scene graph: a pannable/zoomable world container holding
// the tile layer, entity layer and fog layer, plus a screen-space overlay for
// the drag selection box. Owns screen<->world coordinate conversion. Layers are
// persistent; setMap only rebuilds the tile contents.
import { Application, Container, Graphics } from 'pixi.js';
import { buildTileLayer } from './tiles.js';
import { EntityLayer } from './entities.js';
import { TerritoryLayer } from './territory.js';
import { Fog } from './fog.js';

export class GameRenderer {
  readonly app = new Application();
  readonly world = new Container(); // camera: position + scale applied here
  readonly territory = new TerritoryLayer();
  readonly entities = new EntityLayer();
  readonly fog = new Fog();
  readonly selectionBox = new Graphics(); // screen-space overlay
  private readonly tileHolder = new Container();

  async init(): Promise<void> {
    await this.app.init({ resizeTo: window, background: 0x101410, antialias: true });
    document.body.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    // z-order: tiles < territory < entities < fog.
    this.world.addChild(this.tileHolder);
    this.world.addChild(this.territory.container);
    this.world.addChild(this.entities.container);
    this.world.addChild(this.fog.container);
    this.app.stage.addChild(this.selectionBox);
  }

  setMap(mapTiles: number, tile: number, terrain: Uint8Array | null): void {
    this.tileHolder.removeChildren();
    this.tileHolder.addChild(buildTileLayer(mapTiles, tile, terrain));
    this.fog.resetExplored(); // new map — forget previously-explored area
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.world.x) / this.world.scale.x,
      y: (sy - this.world.y) / this.world.scale.y,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx * this.world.scale.x + this.world.x,
      y: wy * this.world.scale.y + this.world.y,
    };
  }

  get screenWidth(): number {
    return this.app.renderer.width;
  }
  get screenHeight(): number {
    return this.app.renderer.height;
  }
}
