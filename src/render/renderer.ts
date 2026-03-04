// PixiJS v8 renderer for the ecosystem simulator
// Efficient dot rendering using Graphics batching

import { Application, Graphics, Container } from 'pixi.js';
import type { SimState, SimConfig } from '../sim/types';

export interface RendererOptions {
  container: HTMLElement;
  width: number;
  height: number;
  trails: boolean;
}

export class Renderer {
  app: Application;
  private plantLayer: Graphics;
  private herbivoreLayer: Graphics;
  private predatorLayer: Graphics;
  private trailLayer: Graphics;
  private fadeOverlay: Graphics;
  private trails: boolean;
  private ready: boolean = false;
  private worldW: number;
  private worldH: number;

  constructor() {
    this.app = new Application();
    this.plantLayer = new Graphics();
    this.herbivoreLayer = new Graphics();
    this.predatorLayer = new Graphics();
    this.trailLayer = new Graphics();
    this.fadeOverlay = new Graphics();
    this.trails = false;
    this.worldW = 0;
    this.worldH = 0;
  }

  async init(options: RendererOptions): Promise<void> {
    await this.app.init({
      width: options.width,
      height: options.height,
      backgroundColor: 0x0a0a0f,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    options.container.appendChild(this.app.canvas);
    this.trails = options.trails;
    this.worldW = options.width;
    this.worldH = options.height;

    // Layer ordering
    this.app.stage.addChild(this.trailLayer);
    this.app.stage.addChild(this.fadeOverlay);
    this.app.stage.addChild(this.plantLayer);
    this.app.stage.addChild(this.herbivoreLayer);
    this.app.stage.addChild(this.predatorLayer);

    this.ready = true;
  }

  setTrails(enabled: boolean): void {
    this.trails = enabled;
    if (!enabled) {
      this.trailLayer.clear();
    }
  }

  render(state: SimState): void {
    if (!this.ready) return;

    const config = state.config;
    const scaleX = this.worldW / config.worldWidth;
    const scaleY = this.worldH / config.worldHeight;

    // === Trails ===
    if (this.trails) {
      // Copy current creature positions to trail layer (faint dots)
      for (let i = 0; i < state.herbivores.length; i++) {
        const h = state.herbivores[i];
        this.trailLayer
          .circle(h.pos.x * scaleX, h.pos.y * scaleY, 1)
          .fill({ color: 0x44aa66, alpha: 0.15 });
      }
      for (let i = 0; i < state.predators.length; i++) {
        const p = state.predators[i];
        this.trailLayer
          .circle(p.pos.x * scaleX, p.pos.y * scaleY, 1)
          .fill({ color: 0xcc5544, alpha: 0.12 });
      }

      // Fade overlay
      this.fadeOverlay.clear();
      this.fadeOverlay
        .rect(0, 0, this.worldW, this.worldH)
        .fill({ color: 0x0a0a0f, alpha: 0.015 });
    }

    // === Plants ===
    this.plantLayer.clear();
    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cellW = this.worldW / cols;
    const cellH = this.worldH / rows;

    // Sample plants - render every cell but skip very low density
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const density = state.plantGrid[y * cols + x];
        if (density < 0.05) continue;

        const alpha = Math.min(density / config.plantCarryingCapacity, 1) * 0.6;
        const px = x * cellW + cellW * 0.5;
        const py = y * cellH + cellH * 0.5;
        const radius = 1.5 + density * 2;

        this.plantLayer
          .circle(px, py, radius)
          .fill({ color: 0x2a6e3a, alpha });
      }
    }

    // === Herbivores ===
    this.herbivoreLayer.clear();
    for (let i = 0; i < state.herbivores.length; i++) {
      const h = state.herbivores[i];
      const px = h.pos.x * scaleX;
      const py = h.pos.y * scaleY;
      const radius = h.traits.size * scaleX * 0.7;

      // Brightness encodes vision range (higher vision = brighter)
      const brightness = 0.4 + Math.min(h.traits.visionRange / 150, 1) * 0.6;

      this.herbivoreLayer
        .circle(px, py, Math.max(1.5, radius))
        .fill({ color: 0x44cc77, alpha: brightness });
    }

    // === Predators ===
    this.predatorLayer.clear();
    for (let i = 0; i < state.predators.length; i++) {
      const p = state.predators[i];
      const px = p.pos.x * scaleX;
      const py = p.pos.y * scaleY;
      const radius = p.traits.size * scaleX * 0.7;

      const brightness = 0.4 + Math.min(p.traits.visionRange / 200, 1) * 0.6;

      this.predatorLayer
        .circle(px, py, Math.max(2, radius))
        .fill({ color: 0xee6655, alpha: brightness });
    }
  }

  resize(width: number, height: number): void {
    if (!this.ready) return;
    this.app.renderer.resize(width, height);
    this.worldW = width;
    this.worldH = height;
    this.trailLayer.clear();
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
