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

  constructor(worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.state = {
      x: worldW / 2,
      y: worldH / 2,
      zoom: 1,
      targetX: worldW / 2,
      targetY: worldH / 2,
      targetZoom: 1,
      following: null,
    };
  }

  resize(worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
  }

  update(): void {
    const lerp = 0.12;
    this.state.x += (this.state.targetX - this.state.x) * lerp;
    this.state.y += (this.state.targetY - this.state.y) * lerp;
    this.state.zoom += (this.state.targetZoom - this.state.zoom) * lerp;
  }

  zoomAt(screenX: number, screenY: number, screenW: number, screenH: number, delta: number): void {
    const worldX = this.screenToWorldX(screenX, screenW);
    const worldY = this.screenToWorldY(screenY, screenH);

    // Normalize: clamp to ±1 direction, apply gentle 3% per step
    const dir = Math.sign(delta);
    const factor = 1 - dir * 0.03;
    this.state.targetZoom = Math.max(0.5, Math.min(4, this.state.targetZoom * factor));

    // Smoothly drift toward cursor rather than snapping
    const blend = 0.3;
    this.state.targetX += (worldX - this.state.targetX) * blend;
    this.state.targetY += (worldY - this.state.targetY) * blend;
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
    this.state.targetZoom = 1;
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
