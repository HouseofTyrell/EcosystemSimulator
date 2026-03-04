// PixiJS v8 renderer using pooled Sprites for efficient ecosystem rendering
// Replaces per-frame Graphics redraws with sprite acquire/release pattern

import { Application, Graphics, Container, Sprite } from 'pixi.js';
import type { SimState } from '../sim/types';
import { SpritePool } from './sprite-pool';
import { generateTextures, type GeneratedTextures } from './textures';

export interface RendererOptions {
  container: HTMLElement;
  width: number;
  height: number;
  trails: boolean;
}

interface ActiveParticle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

// Seasonal background colors
const SEASON_COLORS = [
  { r: 0x0a, g: 0x0f, b: 0x0a }, // Spring: green tint
  { r: 0x0f, g: 0x0f, b: 0x0a }, // Summer: warm
  { r: 0x0f, g: 0x0a, b: 0x0a }, // Autumn: red tint
  { r: 0x0a, g: 0x0a, b: 0x0f }, // Winter: cool blue
];

function lerpColor(season: number): number {
  // season is 0-1, map to 4 seasons with smooth interpolation
  const t = season * 4;
  const i0 = Math.floor(t) % 4;
  const i1 = (i0 + 1) % 4;
  const frac = t - Math.floor(t);

  // Smooth interpolation (smoothstep)
  const s = frac * frac * (3 - 2 * frac);

  const c0 = SEASON_COLORS[i0];
  const c1 = SEASON_COLORS[i1];

  const r = Math.round(c0.r + (c1.r - c0.r) * s);
  const g = Math.round(c0.g + (c1.g - c0.g) * s);
  const b = Math.round(c0.b + (c1.b - c0.b) * s);

  return (r << 16) | (g << 8) | b;
}

export class Renderer {
  app: Application;

  // Layer containers
  private backgroundLayer: Graphics;
  private plantContainer: Container;
  private particleContainer: Container;
  private herbivoreContainer: Container;
  private predatorContainer: Container;
  private trailLayer: Graphics;
  private fadeOverlay: Graphics;

  // Sprite pools
  private plantPool!: SpritePool;
  private herbPool!: SpritePool;
  private predPool!: SpritePool;
  private particlePool!: SpritePool;

  // Textures
  private textures!: GeneratedTextures;

  // Particles
  private particles: ActiveParticle[] = [];

  // State
  private trails: boolean;
  private ready: boolean = false;
  private worldW: number;
  private worldH: number;

  constructor() {
    this.app = new Application();
    this.backgroundLayer = new Graphics();
    this.plantContainer = new Container();
    this.particleContainer = new Container();
    this.herbivoreContainer = new Container();
    this.predatorContainer = new Container();
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

    // Generate textures
    this.textures = generateTextures(this.app);

    // Add layers to stage in proper z-order
    this.app.stage.addChild(this.backgroundLayer);
    this.app.stage.addChild(this.trailLayer);
    this.app.stage.addChild(this.fadeOverlay);
    this.app.stage.addChild(this.plantContainer);
    this.app.stage.addChild(this.particleContainer);
    this.app.stage.addChild(this.herbivoreContainer);
    this.app.stage.addChild(this.predatorContainer);

    // Create sprite pools
    this.plantPool = new SpritePool(this.textures.plant, this.plantContainer);
    this.herbPool = new SpritePool(this.textures.herbivore, this.herbivoreContainer);
    this.predPool = new SpritePool(this.textures.predator, this.predatorContainer);
    this.particlePool = new SpritePool(this.textures.particle, this.particleContainer);

    this.ready = true;
  }

  setTrails(enabled: boolean): void {
    this.trails = enabled;
    if (!enabled) {
      this.trailLayer.clear();
    }
  }

  render(state: SimState, time: number): void {
    if (!this.ready) return;

    const config = state.config;
    const scaleX = this.worldW / config.worldWidth;
    const scaleY = this.worldH / config.worldHeight;

    // === 1. Seasonal background ===
    this.backgroundLayer.clear();
    const bgColor = lerpColor(state.season);
    this.backgroundLayer
      .rect(0, 0, this.worldW, this.worldH)
      .fill({ color: bgColor });

    // === 2. Trails ===
    if (this.trails) {
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

      this.fadeOverlay.clear();
      this.fadeOverlay
        .rect(0, 0, this.worldW, this.worldH)
        .fill({ color: 0x0a0a0f, alpha: 0.015 });
    }

    // === 3. Release all pools ===
    this.plantPool.releaseAll();
    this.herbPool.releaseAll();
    this.predPool.releaseAll();

    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cellW = this.worldW / cols;
    const cellH = this.worldH / rows;

    // === 4. Terrain ===
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const t = state.terrain[idx];
        if (t === 0) continue; // Skip land (no visual)

        const sprite = this.plantPool.acquire();
        sprite.x = x * cellW + cellW * 0.5;
        sprite.y = y * cellH + cellH * 0.5;
        sprite.scale.set(1.2);

        if (t === 1) {
          // Water
          sprite.tint = 0x1a2a4a;
          sprite.alpha = 0.35;
        } else {
          // Fertile
          sprite.tint = 0x1a3a1a;
          sprite.alpha = 0.15;
        }
      }
    }

    // === 5. Plants ===
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const density = state.plantGrid[y * cols + x];
        if (density < 0.05) continue;

        const sprite = this.plantPool.acquire();
        sprite.x = x * cellW + cellW * 0.5;
        sprite.y = y * cellH + cellH * 0.5;
        sprite.tint = 0x2a6e3a;
        sprite.alpha = Math.min(density / config.plantCarryingCapacity, 1) * 0.6;
        const s = 0.5 + density * 0.8;
        sprite.scale.set(s);
      }
    }

    // === Corpses ===
    for (let i = 0; i < state.corpses.length; i++) {
      const c = state.corpses[i];
      const sprite = this.plantPool.acquire();
      sprite.x = c.x * scaleX;
      sprite.y = c.y * scaleY;
      sprite.tint = c.creatureType === 'herbivore' ? 0x336644 : 0x884433;
      sprite.alpha = (c.decayTimer / c.maxDecay) * 0.5;
      sprite.scale.set(0.6);
    }

    // === 6. Herbivores ===
    for (let i = 0; i < state.herbivores.length; i++) {
      const h = state.herbivores[i];
      const sprite = this.herbPool.acquire();

      sprite.x = h.pos.x * scaleX;
      sprite.y = h.pos.y * scaleY;
      sprite.tint = 0x44cc77;
      sprite.rotation = Math.atan2(h.vel.y, h.vel.x);

      // Base scale from size trait with breathing animation
      const baseScale = h.traits.size * scaleX * 0.12;
      const breathe = 1 + 0.06 * Math.sin(time * 3 + h.id * 0.7);
      sprite.scale.set(baseScale * breathe);

      // Alpha from vision range
      let alpha = 0.4 + Math.min(h.traits.visionRange / 150, 1) * 0.6;

      // Low energy fade
      if (h.energy < 25) {
        alpha *= Math.max(0.35, h.energy / 25);
      }

      sprite.alpha = alpha;
    }

    // === 7. Predators ===
    for (let i = 0; i < state.predators.length; i++) {
      const p = state.predators[i];
      const sprite = this.predPool.acquire();

      sprite.x = p.pos.x * scaleX;
      sprite.y = p.pos.y * scaleY;
      sprite.tint = 0xee6655;
      sprite.rotation = Math.atan2(p.vel.y, p.vel.x);

      // Base scale from size trait with prowl animation
      const baseScale = p.traits.size * scaleX * 0.12;
      const prowlPhase = Math.sin(time * 4 + p.id * 0.5);
      const sx = baseScale * (1 + 0.08 * prowlPhase);
      const sy = baseScale * (1 - 0.04 * prowlPhase);
      sprite.scale.set(sx, sy);

      // Alpha from vision range
      let alpha = 0.4 + Math.min(p.traits.visionRange / 200, 1) * 0.6;

      // Low energy fade
      if (p.energy < 25) {
        alpha *= Math.max(0.35, p.energy / 25);
      }

      sprite.alpha = alpha;
    }

    // === 8. Process events ===
    for (let i = 0; i < state.events.length; i++) {
      const ev = state.events[i];
      const ex = ev.x * scaleX;
      const ey = ev.y * scaleY;

      if (ev.type === 'death') {
        // Spawn 4 particles spreading outward
        for (let j = 0; j < 4; j++) {
          const angle = (j / 4) * Math.PI * 2 + Math.random() * 0.5;
          const speed = 30 + Math.random() * 40;
          const sprite = this.particlePool.acquire();
          sprite.x = ex;
          sprite.y = ey;
          sprite.tint = ev.creatureType === 'herbivore' ? 0x44cc77 : 0xee6655;
          sprite.alpha = 1;
          sprite.scale.set(0.8);

          this.particles.push({
            sprite,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.8,
            maxLife: 0.8,
          });
        }
      } else if (ev.type === 'birth') {
        // Spawn 1 white particle
        const sprite = this.particlePool.acquire();
        sprite.x = ex;
        sprite.y = ey;
        sprite.tint = 0xffffff;
        sprite.alpha = 0.8;
        sprite.scale.set(0.8);

        this.particles.push({
          sprite,
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20,
          life: 0.5,
          maxLife: 0.5,
        });
      }
    }

    // === 9. Update active particles ===
    const dt = 1 / 60;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.life -= dt;

      if (part.life <= 0) {
        this.particlePool.release(part.sprite);
        this.particles.splice(i, 1);
        continue;
      }

      part.sprite.x += part.vx * dt;
      part.sprite.y += part.vy * dt;

      const t = part.life / part.maxLife;
      part.sprite.alpha = t;
      part.sprite.scale.set(t * 0.8);
    }
  }

  resize(width: number, height: number): void {
    if (!this.ready) return;
    this.app.renderer.resize(width, height);
    this.worldW = width;
    this.worldH = height;
    this.trailLayer.clear();

    // Clear particles on resize
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particlePool.release(this.particles[i].sprite);
    }
    this.particles.length = 0;
  }

  destroy(): void {
    // Clean up particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particlePool.release(this.particles[i].sprite);
    }
    this.particles.length = 0;

    this.app.destroy(true);
  }
}
