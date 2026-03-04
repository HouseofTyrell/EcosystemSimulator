// PixiJS v8 renderer using pooled Sprites for efficient ecosystem rendering
// Replaces per-frame Graphics redraws with sprite acquire/release pattern

import { Application, Graphics, Container, Sprite, BlurFilter, RenderTexture } from 'pixi.js';
import type { SimState } from '../sim/types';
import type { CameraState } from '../camera';
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

interface AmbientParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  tint: number;
  alpha: number;
  scale: number;
  type: 'mist' | 'pollen' | 'firefly';
}

// Seasonal background colors
const SEASON_COLORS = [
  { r: 0x18, g: 0x33, b: 0x18 }, // Spring: lush green
  { r: 0x33, g: 0x2d, b: 0x12 }, // Summer: warm amber
  { r: 0x33, g: 0x1a, b: 0x10 }, // Autumn: deep rust
  { r: 0x10, g: 0x18, b: 0x36 }, // Winter: deep blue
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

function getLifeVisuals(age: number, maxAge: number): { scaleMul: number; tintMix: number; glowAlphaMul: number } {
  const ratio = age / maxAge;
  if (ratio < 0.15) {
    return { scaleMul: 0.6, tintMix: 0, glowAlphaMul: 1.2 };
  }
  if (ratio < 0.75) {
    return { scaleMul: 1.0, tintMix: 0, glowAlphaMul: 1.0 };
  }
  const elderProgress = (ratio - 0.75) / 0.25;
  return { scaleMul: 0.9, tintMix: elderProgress * 0.4, glowAlphaMul: 1.0 - elderProgress * 0.5 };
}

function getNightAlpha(dayPhase: number): number {
  let nightIntensity: number;
  if (dayPhase < 0.2) {
    nightIntensity = 1 - dayPhase / 0.2;
  } else if (dayPhase < 0.55) {
    nightIntensity = 0;
  } else if (dayPhase < 0.75) {
    nightIntensity = (dayPhase - 0.55) / 0.2;
  } else {
    nightIntensity = 1;
  }
  const t = nightIntensity;
  return t * t * (3 - 2 * t) * 0.4;
}

function hueShiftByLineage(baseTint: number, lineageId: number, range: number): number {
  const hash = ((lineageId * 2654435761) >>> 0) / 0xffffffff;
  const shift = (hash - 0.5) * 2 * range;

  const r = ((baseTint >> 16) & 0xff) / 255;
  const g = ((baseTint >> 8) & 0xff) / 255;
  const b = (baseTint & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return baseTint;

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  h = ((h + shift / 360) % 1 + 1) % 1;

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const nr = Math.round(hue2rgb(p, q, h + 1/3) * 255);
  const ng = Math.round(hue2rgb(p, q, h) * 255);
  const nb = Math.round(hue2rgb(p, q, h - 1/3) * 255);

  return (nr << 16) | (ng << 8) | nb;
}

function mixTintGrey(tint: number, mix: number): number {
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  const grey = 0x88;
  const nr = Math.round(r + (grey - r) * mix);
  const ng = Math.round(g + (grey - g) * mix);
  const nb = Math.round(b + (grey - b) * mix);
  return (nr << 16) | (ng << 8) | nb;
}

export class Renderer {
  app: Application;

  // Layer containers
  private backgroundLayer: Graphics;
  private plantContainer: Container;
  private particleContainer: Container;
  private shadowContainer: Container;
  private glowContainer: Container;
  private herbivoreContainer: Container;
  private scavengerContainer: Container;
  private predatorContainer: Container;
  private trailLayer: Graphics;
  private fadeOverlay: Graphics;
  private nightOverlay: Graphics;
  private weatherLayer: Graphics;

  // Sprite pools
  private plantPool!: SpritePool;
  private herbPool!: SpritePool;
  private scavPool!: SpritePool;
  private predPool!: SpritePool;
  private particlePool!: SpritePool;
  private glowPool!: SpritePool;
  private shadowPool!: SpritePool;

  // Terrain cache
  private terrainTexture: RenderTexture | null = null;
  private terrainSprite: Sprite | null = null;
  private terrainGraphics: Graphics = new Graphics();
  private terrainDirty: boolean = true;
  private lastTerrainSeason: number = -1;
  private lastTerrainEvent: string = '';
  private waterOverlay: Graphics = new Graphics();
  private waterFrame: number = 0;

  // Textures
  private textures!: GeneratedTextures;

  // Particles
  private particles: ActiveParticle[] = [];
  private ambientParticles: AmbientParticle[] = [];
  private ambientSprites: Sprite[] = []; // frame-only sprites to release next frame

  // State
  private trails: boolean;
  private trailFadeAlpha: number = 0.03;
  private trailFrameCount: number = 0;
  private ready: boolean = false;
  private worldW: number;
  private worldH: number;
  private dayNightEnabled: boolean = true;
  private weatherEnabled: boolean = true;

  constructor() {
    this.app = new Application();
    this.backgroundLayer = new Graphics();
    this.plantContainer = new Container();
    this.particleContainer = new Container();
    this.shadowContainer = new Container();
    this.glowContainer = new Container();
    this.herbivoreContainer = new Container();
    this.scavengerContainer = new Container();
    this.predatorContainer = new Container();
    this.trailLayer = new Graphics();
    this.fadeOverlay = new Graphics();
    this.nightOverlay = new Graphics();
    this.weatherLayer = new Graphics();
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

    // Create terrain cache RenderTexture
    this.terrainTexture = RenderTexture.create({
      width: options.width,
      height: options.height,
      resolution: 1,
    });
    this.terrainSprite = new Sprite(this.terrainTexture);

    // Add layers to stage in proper z-order
    this.app.stage.addChild(this.backgroundLayer);
    this.app.stage.addChild(this.terrainSprite!);
    this.app.stage.addChild(this.waterOverlay);
    this.app.stage.addChild(this.trailLayer);
    this.app.stage.addChild(this.fadeOverlay);
    this.app.stage.addChild(this.plantContainer);
    this.app.stage.addChild(this.particleContainer);
    this.app.stage.addChild(this.shadowContainer);
    this.app.stage.addChild(this.glowContainer);
    this.app.stage.addChild(this.herbivoreContainer);
    this.app.stage.addChild(this.scavengerContainer);
    this.app.stage.addChild(this.predatorContainer);
    this.app.stage.addChild(this.weatherLayer);
    this.app.stage.addChild(this.nightOverlay);

    // Create sprite pools
    this.plantPool = new SpritePool(this.textures.plant, this.plantContainer);
    this.herbPool = new SpritePool(this.textures.herbivore, this.herbivoreContainer);
    this.scavPool = new SpritePool(this.textures.scavenger, this.scavengerContainer);
    this.predPool = new SpritePool(this.textures.predator, this.predatorContainer);
    this.particlePool = new SpritePool(this.textures.particle, this.particleContainer);
    this.glowPool = new SpritePool(this.textures.glow, this.glowContainer);
    this.shadowPool = new SpritePool(this.textures.shadow, this.shadowContainer);

    // Bloom effect on glows
    this.glowContainer.filters = [new BlurFilter({ strength: 5, quality: 2 })];
    this.glowContainer.blendMode = 'add';
    this.particleContainer.blendMode = 'add';

    this.ready = true;
  }

  setTrails(enabled: boolean): void {
    this.trails = enabled;
    if (!enabled) {
      this.trailLayer.clear();
      this.trailFrameCount = 0;
    }
  }

  setTrailFade(alpha: number): void {
    this.trailFadeAlpha = alpha;
  }

  setDayNight(enabled: boolean): void {
    this.dayNightEnabled = enabled;
    if (!enabled) this.nightOverlay.clear();
  }

  setWeather(enabled: boolean): void {
    this.weatherEnabled = enabled;
    if (!enabled) this.weatherLayer.clear();
  }

  render(state: SimState, time: number, selectedIds?: number[], camera?: CameraState): void {
    if (!this.ready) return;

    // Apply camera transform to stage
    if (camera) {
      this.app.stage.scale.set(camera.zoom);
      this.app.stage.position.set(
        this.worldW / 2 - camera.x * camera.zoom,
        this.worldH / 2 - camera.y * camera.zoom
      );
    } else {
      this.app.stage.scale.set(1);
      this.app.stage.position.set(0, 0);
    }

    const config = state.config;
    const scaleX = this.worldW / config.worldWidth;
    const scaleY = this.worldH / config.worldHeight;
    const nightAlpha = this.dayNightEnabled ? getNightAlpha(state.dayPhase) : 0;
    const nightGlowBoost = 1 + nightAlpha * 1.5; // Glows 60% brighter at full night

    // === 1. Seasonal background ===
    this.backgroundLayer.clear();
    const bgColor = lerpColor(state.season);
    let finalBgColor = bgColor;
    if (state.activeEvent) {
      if (state.activeEvent.type === 'drought') {
        // Shift toward brown
        const r = (bgColor >> 16) & 0xff;
        const g = (bgColor >> 8) & 0xff;
        const b = bgColor & 0xff;
        finalBgColor = (Math.min(r + 5, 255) << 16) | (g << 8) | Math.max(b - 3, 0);
      } else if (state.activeEvent.type === 'bloom') {
        const r = (bgColor >> 16) & 0xff;
        const g = (bgColor >> 8) & 0xff;
        const b = bgColor & 0xff;
        finalBgColor = (r << 16) | (Math.min(g + 5, 255) << 8) | b;
      }
    }
    this.backgroundLayer
      .rect(0, 0, this.worldW, this.worldH)
      .fill({ color: finalBgColor });

    // Dawn/dusk warm tint — enhanced golden hour
    const isDawn = state.dayPhase < 0.2;
    const isDusk = state.dayPhase > 0.55 && state.dayPhase < 0.75;
    const isNight = state.dayPhase > 0.75 || state.dayPhase < 0.05;
    if (this.dayNightEnabled && (isDawn || isDusk)) {
      const progress = isDawn ? (1 - state.dayPhase / 0.2) : ((state.dayPhase - 0.55) / 0.2);
      const tintColor = isDawn ? 0xdd8844 : 0xcc5522;
      const maxAlpha = 0.15;
      // Horizon gradient: 3 bands, warmest at bottom
      const bandH = this.worldH / 3;
      for (let band = 0; band < 3; band++) {
        const bandAlpha = progress * maxAlpha * (1 - band * 0.3);
        this.backgroundLayer
          .rect(0, band * bandH, this.worldW, bandH)
          .fill({ color: tintColor, alpha: bandAlpha });
      }
    }

    if (!state.config.wrapWorld) {
      this.backgroundLayer
        .rect(1, 1, this.worldW - 2, this.worldH - 2)
        .stroke({ color: 0x334455, width: 2, alpha: 0.6 });
    }

    // === 2. Trails ===
    if (this.trails) {
      this.trailFrameCount++;

      // Periodically clear to prevent unbounded Graphics command growth
      if (this.trailFrameCount > 3600) {
        this.trailLayer.clear();
        this.trailFrameCount = 0;
      }

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
      for (let i = 0; i < state.scavengers.length; i++) {
        const s = state.scavengers[i];
        this.trailLayer
          .circle(s.pos.x * scaleX, s.pos.y * scaleY, 1)
          .fill({ color: 0xccaa44, alpha: 0.12 });
      }

      this.fadeOverlay.clear();
      this.fadeOverlay
        .rect(0, 0, this.worldW, this.worldH)
        .fill({ color: 0x0a0a0f, alpha: this.trailFadeAlpha });
    }

    // === 3. Release all pools ===
    this.plantPool.releaseAll();
    this.herbPool.releaseAll();
    this.scavPool.releaseAll();
    this.predPool.releaseAll();
    this.glowPool.releaseAll();
    this.shadowPool.releaseAll();

    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cellW = this.worldW / cols;
    const cellH = this.worldH / rows;

    // === 4. Terrain (cached) ===
    const currentEvent = state.activeEvent?.type || '';
    if (
      this.terrainDirty ||
      Math.abs(state.season - this.lastTerrainSeason) > 0.01 ||
      currentEvent !== this.lastTerrainEvent
    ) {
      this.renderTerrain(state);
      this.lastTerrainSeason = state.season;
      this.lastTerrainEvent = currentEvent;
    }

    // Animated water shimmer overlay (every 3rd frame)
    this.waterFrame++;
    if (this.waterFrame % 3 === 0) {
      this.renderWaterOverlay(state, time);
    }

    // === 5. Plants — clustered dots to break grid pattern ===
    const hasWind = state.weather?.type === 'wind' && state.weather.intensity > 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const density = state.plantGrid[idx];
        if (density < 0.15) continue; // Higher threshold: skip sparse cells

        const norm = Math.min(density / config.plantCarryingCapacity, 1);
        const dotCount = norm > 0.7 ? 3 : norm > 0.35 ? 2 : 1;

        // Wind sway offset for plants
        const windOffset = hasWind
          ? Math.sin(time * 1.5 + idx * 0.3) * state.weather.intensity * 2
          : 0;

        for (let d = 0; d < dotCount; d++) {
          const sprite = this.plantPool.acquire();
          // Each sub-dot has unique deterministic jitter
          const seed1 = ((idx * 2654435761 + d * 40503) >>> 0) / 0xffffffff;
          const seed2 = ((idx * 340573321 + d * 22291) >>> 0) / 0xffffffff;
          const jx = (seed1 - 0.5) * cellW * 1.4;
          const jy = (seed2 - 0.5) * cellH * 1.4;
          sprite.x = x * cellW + cellW * 0.5 + jx + windOffset;
          sprite.y = y * cellH + cellH * 0.5 + jy;
          // Vary green per dot for texture
          const greenVar = 0x28 + Math.floor(seed1 * 0x18);
          sprite.tint = (0x1a << 16) | (greenVar << 8) | 0x28;
          sprite.alpha = norm * 0.45 + 0.08;
          sprite.scale.set(0.35 + norm * 0.6);
        }
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

    // Shadow offset scales with sun angle (dawn/dusk = longer shadows)
    const sunProgress = (isDawn || isDusk)
      ? (isDawn ? (1 - state.dayPhase / 0.2) : ((state.dayPhase - 0.55) / 0.2))
      : 0;
    const shadowOffset = 2 + sunProgress * 3;

    // === 6. Herbivores ===
    for (let i = 0; i < state.herbivores.length; i++) {
      const h = state.herbivores[i];
      const sprite = this.herbPool.acquire();

      sprite.x = h.pos.x * scaleX;
      sprite.y = h.pos.y * scaleY;
      const lineageTintH = hueShiftByLineage(0x5dd880, h.lineageId, 25);
      sprite.tint = lineageTintH;
      sprite.rotation = Math.atan2(h.vel.y, h.vel.x);

      // Base scale from size trait with breathing animation
      const life = getLifeVisuals(h.age, h.maxAge);
      if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTintH, life.tintMix);
      const baseScale = h.traits.size * scaleX * 0.28 * life.scaleMul;
      const breathe = 1 + 0.04 * Math.sin(time * 3 + h.id * 0.7);
      sprite.scale.set(baseScale * breathe);

      // Alpha — solid creatures from satellite view
      let alpha = 0.8 + Math.min(h.traits.visionRange / 150, 1) * 0.2;
      if (h.energy < 25) alpha *= Math.max(0.5, h.energy / 25);
      sprite.alpha = alpha;

      // Ground shadow
      const shadowH = this.shadowPool.acquire();
      shadowH.x = sprite.x + shadowOffset;
      shadowH.y = sprite.y + shadowOffset;
      shadowH.rotation = sprite.rotation;
      shadowH.scale.set(baseScale * 1.1);
      shadowH.alpha = 0.3;

      const glowH = this.glowPool.acquire();
      glowH.x = sprite.x;
      glowH.y = sprite.y;
      glowH.tint = lineageTintH;
      const lineageSizeH = state.lineageCounts?.get(h.lineageId) || 1;
      const dominanceGlowH = lineageSizeH >= 10 ? 0.8 : lineageSizeH >= 5 ? 0.6 : 0.35;
      glowH.alpha = Math.min(1, (dominanceGlowH + 0.1 * Math.sin(time * 2 + h.id)) * life.glowAlphaMul * nightGlowBoost);
      glowH.scale.set(baseScale * 2.0);

      if (selectedIds && selectedIds.includes(h.id)) {
        const ring = this.glowPool.acquire();
        ring.x = sprite.x;
        ring.y = sprite.y;
        ring.tint = 0xffffff;
        ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
        ring.scale.set(baseScale * 5);
        const ring2 = this.glowPool.acquire();
        ring2.x = sprite.x;
        ring2.y = sprite.y;
        ring2.tint = lineageTintH;
        ring2.alpha = 0.9;
        ring2.scale.set(baseScale * 3.5);
      }
    }

    // === 7. Predators ===
    for (let i = 0; i < state.predators.length; i++) {
      const p = state.predators[i];
      const sprite = this.predPool.acquire();

      sprite.x = p.pos.x * scaleX;
      sprite.y = p.pos.y * scaleY;
      const lineageTintP = hueShiftByLineage(0xe87744, p.lineageId, 25);
      sprite.tint = lineageTintP;
      sprite.rotation = Math.atan2(p.vel.y, p.vel.x);

      // Base scale from size trait with prowl animation
      const life = getLifeVisuals(p.age, p.maxAge);
      if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTintP, life.tintMix);
      const baseScale = p.traits.size * scaleX * 0.28 * life.scaleMul;
      const prowlPhase = Math.sin(time * 4 + p.id * 0.5);
      const sx = baseScale * (1 + 0.06 * prowlPhase);
      const sy = baseScale * (1 - 0.03 * prowlPhase);
      sprite.scale.set(sx, sy);

      // Alpha — solid creatures from satellite view
      let alpha = 0.85 + Math.min(p.traits.visionRange / 200, 1) * 0.15;
      if (p.energy < 25) alpha *= Math.max(0.5, p.energy / 25);
      sprite.alpha = alpha;

      // Ground shadow
      const shadowP = this.shadowPool.acquire();
      shadowP.x = sprite.x + shadowOffset;
      shadowP.y = sprite.y + shadowOffset;
      shadowP.rotation = sprite.rotation;
      shadowP.scale.set(baseScale * 1.1);
      shadowP.alpha = 0.3;

      const glowP = this.glowPool.acquire();
      glowP.x = sprite.x;
      glowP.y = sprite.y;
      glowP.tint = lineageTintP;
      const lineageSizeP = state.lineageCounts?.get(p.lineageId) || 1;
      const dominanceGlowP = lineageSizeP >= 10 ? 0.8 : lineageSizeP >= 5 ? 0.6 : 0.35;
      glowP.alpha = Math.min(1, (dominanceGlowP + 0.1 * Math.sin(time * 2 + p.id)) * life.glowAlphaMul * nightGlowBoost);
      glowP.scale.set(baseScale * 2.0);

      if (selectedIds && selectedIds.includes(p.id)) {
        const ring = this.glowPool.acquire();
        ring.x = sprite.x;
        ring.y = sprite.y;
        ring.tint = 0xffffff;
        ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
        ring.scale.set(baseScale * 5);
        const ring2 = this.glowPool.acquire();
        ring2.x = sprite.x;
        ring2.y = sprite.y;
        ring2.tint = lineageTintP;
        ring2.alpha = 0.9;
        ring2.scale.set(baseScale * 3.5);
      }
    }

    // === 8. Scavengers ===
    for (let i = 0; i < state.scavengers.length; i++) {
      const s = state.scavengers[i];
      const sprite = this.scavPool.acquire();
      sprite.x = s.pos.x * scaleX;
      sprite.y = s.pos.y * scaleY;
      const lineageTintS = hueShiftByLineage(0xd4a840, s.lineageId, 25);
      sprite.tint = lineageTintS;
      sprite.rotation = Math.atan2(s.vel.y, s.vel.x);
      const life = getLifeVisuals(s.age, s.maxAge);
      if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTintS, life.tintMix);
      const baseScale = s.traits.size * scaleX * 0.28 * life.scaleMul;
      const breathe = 1 + 0.04 * Math.sin(time * 2.5 + s.id * 0.9);
      sprite.scale.set(baseScale * breathe);
      let alpha = 0.8 + Math.min(s.traits.visionRange / 150, 1) * 0.2;
      if (s.energy < 25) alpha *= Math.max(0.5, s.energy / 25);
      sprite.alpha = alpha;

      // Ground shadow
      const shadowS = this.shadowPool.acquire();
      shadowS.x = sprite.x + shadowOffset;
      shadowS.y = sprite.y + shadowOffset;
      shadowS.rotation = sprite.rotation;
      shadowS.scale.set(baseScale * 1.0);
      shadowS.alpha = 0.3;

      const glowS = this.glowPool.acquire();
      glowS.x = sprite.x;
      glowS.y = sprite.y;
      glowS.tint = lineageTintS;
      const lineageSizeS = state.lineageCounts?.get(s.lineageId) || 1;
      const dominanceGlowS = lineageSizeS >= 10 ? 0.8 : lineageSizeS >= 5 ? 0.6 : 0.35;
      glowS.alpha = Math.min(1, (dominanceGlowS + 0.1 * Math.sin(time * 2 + s.id)) * life.glowAlphaMul * nightGlowBoost);
      glowS.scale.set(baseScale * 2.0);

      if (selectedIds && selectedIds.includes(s.id)) {
        const ring = this.glowPool.acquire();
        ring.x = sprite.x;
        ring.y = sprite.y;
        ring.tint = 0xffffff;
        ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
        ring.scale.set(baseScale * 5);
        const ring2 = this.glowPool.acquire();
        ring2.x = sprite.x;
        ring2.y = sprite.y;
        ring2.tint = lineageTintS;
        ring2.alpha = 0.9;
        ring2.scale.set(baseScale * 3.5);
      }
    }

    // === 9. Process events ===
    for (let i = 0; i < state.events.length; i++) {
      const ev = state.events[i];
      const ex = ev.x * scaleX;
      const ey = ev.y * scaleY;

      if (ev.type === 'death') {
        // Gentle drifting particles
        for (let j = 0; j < 6; j++) {
          const angle = (j / 6) * Math.PI * 2 + Math.random() * 0.5;
          const speed = 15 + Math.random() * 20;
          const sprite = this.particlePool.acquire();
          sprite.x = ex;
          sprite.y = ey;
          sprite.tint = ev.creatureType === 'herbivore' ? 0x44cc77 : ev.creatureType === 'scavenger' ? 0xccaa44 : 0xee6655;
          sprite.alpha = 0.9;
          sprite.scale.set(1.2);

          this.particles.push({
            sprite,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 5, // slight upward drift
            life: 1.5,
            maxLife: 1.5,
          });
        }
      } else if (ev.type === 'birth') {
        // Gentle sparkle burst
        const birthTint = ev.creatureType === 'herbivore' ? 0xaaffcc :
                          ev.creatureType === 'predator' ? 0xffaa88 : 0xffeebb;
        for (let j = 0; j < 3; j++) {
          const sprite = this.particlePool.acquire();
          sprite.x = ex;
          sprite.y = ey;
          sprite.tint = birthTint;
          sprite.alpha = 0.9;
          sprite.scale.set(1.5);

          this.particles.push({
            sprite,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10 - 8, // float upward
            life: 1.2,
            maxLife: 1.2,
          });
        }
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

    // === Ambient particles (mist, pollen, fireflies) ===
    // Release sprites from previous frame
    for (let i = 0; i < this.ambientSprites.length; i++) {
      this.particlePool.release(this.ambientSprites[i]);
    }
    this.ambientSprites.length = 0;

    const maxAmbient = isNight ? 60 : 40;

    // Spawn new particles
    while (this.ambientParticles.length < maxAmbient) {
      const roll = Math.random();
      if (isNight && roll < 0.4) {
        // Firefly
        this.ambientParticles.push({
          x: Math.random() * this.worldW,
          y: Math.random() * this.worldH,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          life: 4 + Math.random() * 4,
          maxLife: 8,
          tint: 0xffeebb,
          alpha: 0.25,
          scale: 0.3,
          type: 'firefly',
        });
      } else if (roll < 0.6) {
        // Mist near water (light-blue, drifts upward)
        this.ambientParticles.push({
          x: Math.random() * this.worldW,
          y: Math.random() * this.worldH,
          vx: (Math.random() - 0.5) * 2,
          vy: -0.5 - Math.random() * 0.5,
          life: 3 + Math.random() * 3,
          maxLife: 6,
          tint: 0x8899cc,
          alpha: 0.12,
          scale: 0.5,
          type: 'mist',
        });
      } else {
        // Pollen over vegetation (drifts with wind)
        this.ambientParticles.push({
          x: Math.random() * this.worldW,
          y: Math.random() * this.worldH,
          vx: (Math.random() - 0.5) * 4 + (state.weather.type === 'wind' ? state.weather.intensity * 8 : 0),
          vy: (Math.random() - 0.5) * 2,
          life: 2 + Math.random() * 3,
          maxLife: 5,
          tint: 0xaacc55,
          alpha: 0.1,
          scale: 0.25,
          type: 'pollen',
        });
      }
    }

    // Update and render ambient particles
    for (let i = this.ambientParticles.length - 1; i >= 0; i--) {
      const ap = this.ambientParticles[i];
      ap.x += ap.vx * dt;
      ap.y += ap.vy * dt;
      ap.life -= dt;
      if (ap.life <= 0 || ap.x < -10 || ap.x > this.worldW + 10 || ap.y < -10 || ap.y > this.worldH + 10) {
        this.ambientParticles.splice(i, 1);
        continue;
      }

      const sprite = this.particlePool.acquire();
      sprite.texture = this.textures.particle;
      sprite.x = ap.x;
      sprite.y = ap.y;
      sprite.tint = ap.tint;
      const fadeRatio = ap.life / ap.maxLife;
      let alpha = ap.alpha * fadeRatio;
      // Firefly pulsing
      if (ap.type === 'firefly') {
        alpha *= 0.5 + 0.5 * Math.sin(time * 3 + i * 1.7);
      }
      sprite.alpha = Math.max(0, alpha);
      sprite.scale.set(ap.scale);
      this.ambientSprites.push(sprite);
    }

    // === Weather visuals ===
    this.weatherLayer.clear();
    if (this.weatherEnabled && state.weather.type !== 'clear' && state.weather.intensity > 0.01) {
      const wi = state.weather.intensity;

      if (state.weather.type === 'rain') {
        // Batch all rain lines into a single stroke call
        const rainCount = Math.floor(wi * 200);
        for (let i = 0; i < rainCount; i++) {
          const rx = ((i * 3571 + Math.floor(time * 200)) % this.worldW);
          const baseY = ((i * 7127 + Math.floor(time * 400)) % (this.worldH + 40)) - 20;
          const len = 8 + (i % 6) * 2.5;
          this.weatherLayer.moveTo(rx, baseY).lineTo(rx - 1, baseY + len);
        }
        this.weatherLayer.stroke({ color: 0x5577bb, width: 1.5, alpha: wi * 0.4 });

        this.weatherLayer
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0x223355, alpha: wi * 0.1 });

        // Background rain layer — single batched stroke
        const bgRainCount = Math.floor(rainCount * 0.5);
        for (let j = 0; j < bgRainCount; j++) {
          const bx = ((j * 5501 + Math.floor(time * 160)) % this.worldW);
          const by = ((j * 8363 + Math.floor(time * 320)) % (this.worldH + 30)) - 15;
          const bgLen = 6 + (j % 4) * 1.5;
          this.weatherLayer.moveTo(bx, by).lineTo(bx - 0.5 + Math.sin(0.1) * bgLen, by + Math.cos(0.1) * bgLen);
        }
        if (bgRainCount > 0) this.weatherLayer.stroke({ color: 0x8899bb, width: 0.5, alpha: 0.08 * wi });
      }

      if (state.weather.type === 'fog') {
        // Subtle flat tint base
        this.weatherLayer
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0xddddcc, alpha: wi * 0.08 });

        // Volumetric fog blobs using glow sprites
        const fogCount = Math.floor(3 + wi * 4);
        for (let f = 0; f < fogCount; f++) {
          const fogSprite = this.glowPool.acquire();
          const seed = f * 137.5;
          fogSprite.texture = this.textures.glow;
          fogSprite.x = ((seed + time * 5) % this.worldW);
          fogSprite.y = ((seed * 2.3 + time * 3) % this.worldH);
          fogSprite.tint = 0xccccbb;
          fogSprite.alpha = wi * 0.12;
          fogSprite.scale.set(20 + wi * 15);
        }
      }

      if (state.weather.type === 'wind') {
        // Batch all wind lines into a single stroke call
        const windAngle = state.weather.windAngle;
        const lineCount = Math.floor(wi * 60);
        const cos = Math.cos(windAngle);
        const sin = Math.sin(windAngle);
        for (let i = 0; i < lineCount; i++) {
          const bx = ((i * 4793 + Math.floor(time * 100 * Math.abs(cos + 0.1))) % this.worldW);
          const by = ((i * 6151 + Math.floor(time * 100 * Math.abs(sin + 0.1))) % this.worldH);
          const len = 15 + (i % 10) * 3;
          this.weatherLayer.moveTo(bx, by).lineTo(bx + cos * len, by + sin * len);
        }
        if (lineCount > 0) this.weatherLayer.stroke({ color: 0x99aabb, width: 1, alpha: wi * 0.22 });
      }
    }

    // === Night overlay ===
    this.nightOverlay.clear();
    if (this.dayNightEnabled) {
      const nightAlpha = getNightAlpha(state.dayPhase);
      if (nightAlpha > 0.01) {
        this.nightOverlay
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0x05050f, alpha: nightAlpha });

        if (nightAlpha > 0.15) {
          const starCount = Math.floor(nightAlpha * 120);
          for (let i = 0; i < starCount; i++) {
            const sx = ((i * 7919 + 1013) % this.worldW);
            const sy = ((i * 6271 + 2017) % (this.worldH * 0.7)); // Stars in upper 70%
            const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.2 + i * 2.3));
            const size = (i % 5 === 0) ? 1.5 : 1;
            this.nightOverlay
              .circle(sx, sy, size)
              .fill({ color: 0xeeeeff, alpha: nightAlpha * twinkle });
          }
        }
      }
    }
  }

  private renderTerrain(state: SimState): void {
    this.terrainGraphics.clear();
    const config = state.config;
    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cellW = this.worldW / cols;
    const cellH = this.worldH / rows;

    const terrainR = Math.min(cellW, cellH) * 0.5;
    const terrainPad = 2;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const t = state.terrain[idx];
        if (t === 0) continue; // Skip land

        // Check neighbors (same type = interior edge, different = exterior)
        const left  = x > 0       ? state.terrain[idx - 1]    : 0;
        const right = x < cols - 1 ? state.terrain[idx + 1]    : 0;
        const above = y > 0       ? state.terrain[idx - cols]  : 0;
        const below = y < rows - 1 ? state.terrain[idx + cols]  : 0;

        // A corner is exterior if at least one adjacent edge neighbor differs
        const rTL = !(left === t && above === t);
        const rTR = !(right === t && above === t);
        const rBL = !(left === t && below === t);
        const rBR = !(right === t && below === t);

        const px = x * cellW - terrainPad;
        const py = y * cellH - terrainPad;
        const pw = cellW + terrainPad * 2;
        const ph = cellH + terrainPad * 2;
        const cr = Math.min(terrainR, pw / 2, ph / 2);
        const tl = rTL ? cr : 0;
        const tr = rTR ? cr : 0;
        const bl = rBL ? cr : 0;
        const br = rBR ? cr : 0;

        // Draw cell with per-corner rounding using arcTo
        this.terrainGraphics.moveTo(px + tl, py);
        this.terrainGraphics.lineTo(px + pw - tr, py);
        if (tr > 0) this.terrainGraphics.arcTo(px + pw, py, px + pw, py + tr, tr);
        else this.terrainGraphics.lineTo(px + pw, py);
        this.terrainGraphics.lineTo(px + pw, py + ph - br);
        if (br > 0) this.terrainGraphics.arcTo(px + pw, py + ph, px + pw - br, py + ph, br);
        else this.terrainGraphics.lineTo(px + pw, py + ph);
        this.terrainGraphics.lineTo(px + bl, py + ph);
        if (bl > 0) this.terrainGraphics.arcTo(px, py + ph, px, py + ph - bl, bl);
        else this.terrainGraphics.lineTo(px, py + ph);
        this.terrainGraphics.lineTo(px, py + tl);
        if (tl > 0) this.terrainGraphics.arcTo(px, py, px + tl, py, tl);
        else this.terrainGraphics.lineTo(px, py);
        this.terrainGraphics.closePath();

        if (t === 1) {
          this.terrainGraphics.fill({ color: 0x0f2844, alpha: 0.65 });
        } else if (t === 3) {
          this.terrainGraphics.fill({ color: 0x2a2520, alpha: 0.7 });
        } else if (t === 2) {
          this.terrainGraphics.fill({ color: 0x0a1a08, alpha: 0.35 });
        }
      }
    }

    // Render into cached texture
    this.app.renderer.render({
      container: this.terrainGraphics,
      target: this.terrainTexture!,
      clear: true,
    });
    this.terrainDirty = false;
  }

  private renderWaterOverlay(state: SimState, time: number): void {
    this.waterOverlay.clear();
    const config = state.config;
    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cellW = this.worldW / cols;
    const cellH = this.worldH / rows;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        if (state.terrain[idx] !== 1) continue; // Only water (TerrainType.Water = 1)

        // Check if shore cell (has non-water neighbor)
        const left  = x > 0       ? state.terrain[idx - 1] : 0;
        const right = x < cols - 1 ? state.terrain[idx + 1] : 0;
        const above = y > 0       ? state.terrain[idx - cols] : 0;
        const below = y < rows - 1 ? state.terrain[idx + cols] : 0;
        const isShore = left !== 1 || right !== 1 || above !== 1 || below !== 1;

        const cx = x * cellW + cellW / 2;
        const cy = y * cellH + cellH / 2;
        const shimmer = 0.03 * Math.sin(time * 1.5 + x * 0.3 + y * 0.5);

        if (isShore) {
          this.waterOverlay
            .circle(cx, cy, cellW * 0.4)
            .fill({ color: 0x4488cc, alpha: 0.06 + shimmer });
        } else {
          // Deep water caustic
          const a1 = Math.sin(time * 0.8 + x * 0.7 + y * 0.3) * 0.5 + 0.5;
          this.waterOverlay
            .ellipse(cx + a1 * 3, cy + a1 * 2, cellW * 0.3, cellH * 0.25)
            .fill({ color: 0x3366aa, alpha: 0.04 + shimmer * 0.5 });
        }
      }
    }
  }

  resize(width: number, height: number): void {
    if (!this.ready) return;
    this.app.renderer.resize(width, height);
    this.worldW = width;
    this.worldH = height;
    this.trailLayer.clear();

    if (this.terrainTexture) {
      this.terrainTexture.resize(width, height);
      this.terrainDirty = true;
    }

    // Clear particles on resize
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particlePool.release(this.particles[i].sprite);
    }
    this.particles.length = 0;
    this.ambientParticles.length = 0;
    for (let i = 0; i < this.ambientSprites.length; i++) {
      this.particlePool.release(this.ambientSprites[i]);
    }
    this.ambientSprites.length = 0;
  }

  destroy(): void {
    // Clean up particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particlePool.release(this.particles[i].sprite);
    }
    this.particles.length = 0;
    this.ambientParticles.length = 0;
    for (let i = 0; i < this.ambientSprites.length; i++) {
      this.particlePool.release(this.ambientSprites[i]);
    }
    this.ambientSprites.length = 0;

    this.app.destroy(true);
  }
}
