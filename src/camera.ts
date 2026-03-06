export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
  following: number | null;
}

export class Camera {
  state: CameraState;
  private worldW: number;
  private worldH: number;
  private screenW: number;
  private screenH: number;

  constructor(worldW: number, worldH: number, screenW?: number, screenH?: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.screenW = screenW ?? worldW;
    this.screenH = screenH ?? worldH;
    const zoom = Math.min(this.screenW / worldW, this.screenH / worldH);
    this.state = {
      x: worldW / 2,
      y: worldH / 2,
      zoom,
      targetX: worldW / 2,
      targetY: worldH / 2,
      targetZoom: zoom,
      following: null,
    };
  }

  resize(screenW: number, screenH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
  }

  setWorldSize(worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
  }

  update(): void {
    const lerp = 0.12;
    this.state.x += (this.state.targetX - this.state.x) * lerp;
    this.state.y += (this.state.targetY - this.state.y) * lerp;
    this.state.zoom += (this.state.targetZoom - this.state.zoom) * lerp;

    // Clamp camera to world bounds
    this.state.targetX = Math.max(0, Math.min(this.worldW, this.state.targetX));
    this.state.targetY = Math.max(0, Math.min(this.worldH, this.state.targetY));
  }

  zoomAt(screenX: number, screenY: number, screenW: number, screenH: number, delta: number, isPinch: boolean): void {
    // World point under cursor before zoom
    const worldX = this.screenToWorldX(screenX, screenW);
    const worldY = this.screenToWorldY(screenY, screenH);

    const oldZoom = this.state.targetZoom;

    if (isPinch) {
      // Trackpad pinch: delta is small and continuous, use it proportionally
      const scale = 1 - delta * 0.005;
      this.state.targetZoom = Math.max(0.5, Math.min(4, oldZoom * scale));
    } else {
      // Mouse wheel: discrete steps, use fixed 5% increments
      const dir = Math.sign(delta);
      this.state.targetZoom = Math.max(0.5, Math.min(4, oldZoom * (1 - dir * 0.05)));
    }

    // Anchor: adjust camera so the world point under cursor stays put
    const newZoom = this.state.targetZoom;
    if (Math.abs(newZoom - oldZoom) > 0.0001) {
      // screenX = screenW/2 + (worldX - camX) * zoom
      // We want worldX to stay at screenX after zoom changes
      // camX_new = worldX - (screenX - screenW/2) / newZoom
      this.state.targetX = worldX - (screenX - screenW / 2) / newZoom;
      this.state.targetY = worldY - (screenY - screenH / 2) / newZoom;
    }
  }

  panBy(dx: number, dy: number): void {
    this.state.targetX -= dx / this.state.zoom;
    this.state.targetY -= dy / this.state.zoom;
  }

  centerOn(x: number, y: number, zoom?: number): void {
    this.state.targetX = x;
    this.state.targetY = y;
    if (zoom !== undefined) this.state.targetZoom = zoom;
  }

  resetView(): void {
    this.state.targetX = this.worldW / 2;
    this.state.targetY = this.worldH / 2;
    this.state.targetZoom = Math.min(this.screenW / this.worldW, this.screenH / this.worldH);
    this.state.following = null;
  }

  follow(creatureId: number | null): void {
    this.state.following = creatureId;
    if (creatureId !== null) {
      this.state.targetZoom = Math.max(this.state.targetZoom, 2);
    }
  }

  screenToWorldX(screenX: number, screenW: number): number {
    return this.state.x + (screenX - screenW / 2) / this.state.zoom;
  }

  screenToWorldY(screenY: number, screenH: number): number {
    return this.state.y + (screenY - screenH / 2) / this.state.zoom;
  }
}
