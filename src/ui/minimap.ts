import type { SimState } from '../sim/types';
import type { CameraState } from '../camera';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private el: HTMLDivElement;
  private static W = 120;
  private static H = 68;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = Minimap.W;
    this.canvas.height = Minimap.H;
    this.el.appendChild(this.canvas);
    container.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d')!;
  }

  update(state: SimState, camera: CameraState): void {
    if (camera.zoom < 1.2) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = 'block';

    const ctx = this.ctx;
    const W = Minimap.W;
    const H = Minimap.H;
    const config = state.config;

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Terrain
    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cw = W / cols;
    const ch = H / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const t = state.terrain[idx];
        if (t === 1) ctx.fillStyle = '#0f2844';        // Water
        else if (t === 3) ctx.fillStyle = '#2a2520';    // Mountain
        else if (t === 2) ctx.fillStyle = '#0a1a08';    // Fertile
        else {
          const pd = state.plantGrid[idx];
          const g = Math.floor(20 + pd * 40);
          ctx.fillStyle = `rgb(10,${g},10)`;
        }
        ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
      }
    }

    // Creatures as dots
    const sx = W / config.worldWidth;
    const sy = H / config.worldHeight;
    ctx.fillStyle = '#5dd880';
    for (const h of state.herbivores) {
      ctx.fillRect(h.pos.x * sx, h.pos.y * sy, 1.5, 1.5);
    }
    ctx.fillStyle = '#e87744';
    for (const p of state.predators) {
      ctx.fillRect(p.pos.x * sx, p.pos.y * sy, 1.5, 1.5);
    }
    ctx.fillStyle = '#d4a840';
    for (const s of state.scavengers) {
      ctx.fillRect(s.pos.x * sx, s.pos.y * sy, 1.5, 1.5);
    }

    // Viewport rectangle
    const vpW = config.worldWidth / camera.zoom;
    const vpH = config.worldHeight / camera.zoom;
    const vpX = (camera.x - vpW / 2) * sx;
    const vpY = (camera.y - vpH / 2) * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vpX, vpY, vpW * sx, vpH * sy);
  }

  onClick(callback: (worldX: number, worldY: number) => void, config: { worldWidth: number; worldHeight: number }): void {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * config.worldWidth;
      const y = (e.clientY - rect.top) / rect.height * config.worldHeight;
      callback(x, y);
    });
  }
}
