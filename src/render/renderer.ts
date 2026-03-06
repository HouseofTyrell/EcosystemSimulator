// PixiJS v8 renderer using pooled Sprites for efficient ecosystem rendering
// Replaces per-frame Graphics redraws with sprite acquire/release pattern

import { Application, Graphics, Container, Sprite, RenderTexture, Texture } from 'pixi.js';
import type { SimState } from '../sim/types';
import type { CameraState } from '../camera';
import { SpritePool } from './sprite-pool';
import { generateTextures, type GeneratedTextures } from './textures';
import { HERB_SUBSPECIES, PRED_SUBSPECIES, SCAV_SUBSPECIES } from '../sim/subspecies';
import { paintTerrain } from './terrain-painter';

export interface RendererOptions {
  container: HTMLElement;
  width: number;
  height: number;
  trails: boolean;
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

export class Renderer {
  app: Application;

  // Layer containers
  private backgroundLayer: Graphics;
  private shadowContainer: Container;
  private herbivoreContainer: Container;
  private scavengerContainer: Container;
  private predatorContainer: Container;
  private trailLayer: Graphics;
  private fadeOverlay: Graphics;
  private nightOverlay: Graphics;
  private weatherLayer: Graphics;

  // Sprite pools
  private herbPool!: SpritePool;
  private scavPool!: SpritePool;
  private predPool!: SpritePool;
  private shadowPool!: SpritePool;
  private legContainer: Container;
  private legPool!: SpritePool;

  // Terrain cache
  private terrainTexture: RenderTexture | null = null;
  private terrainSprite: Sprite | null = null;
  private terrainCanvas: HTMLCanvasElement | null = null;
  private terrainCtx: CanvasRenderingContext2D | null = null;
  private terrainDirty: boolean = true;
  private lastTerrainSeason: number = -1;
  private lastTerrainEvent: string = '';

  // Vegetation overlay
  private vegCanvas: HTMLCanvasElement | null = null;
  private vegCtx: CanvasRenderingContext2D | null = null;
  private vegSprite: Sprite | null = null;
  private vegUpdateCounter: number = 0;

  // Textures
  private textures!: GeneratedTextures;

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
    this.shadowContainer = new Container();
    this.herbivoreContainer = new Container();
    this.scavengerContainer = new Container();
    this.predatorContainer = new Container();
    this.trailLayer = new Graphics();
    this.fadeOverlay = new Graphics();
    this.nightOverlay = new Graphics();
    this.weatherLayer = new Graphics();
    this.legContainer = new Container();
    this.trails = false;
    this.worldW = 0;
    this.worldH = 0;
  }

  async init(options: RendererOptions): Promise<void> {
    await this.app.init({
      width: options.width,
      height: options.height,
      backgroundColor: 0x1a1510,  // Dark earthy brown
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

    const terrainScale = 0.5;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = Math.ceil(options.width * terrainScale);
    this.terrainCanvas.height = Math.ceil(options.height * terrainScale);
    this.terrainCtx = this.terrainCanvas.getContext('2d')!;

    this.vegCanvas = document.createElement('canvas');
    this.vegCanvas.width = options.width;
    this.vegCanvas.height = options.height;
    this.vegCtx = this.vegCanvas.getContext('2d')!;
    this.vegSprite = Sprite.from(this.vegCanvas);
    this.vegSprite.blendMode = 'multiply';
    this.vegSprite.alpha = 0.6;

    // Add layers to stage in proper z-order
    this.app.stage.addChild(this.backgroundLayer);
    this.app.stage.addChild(this.terrainSprite!);
    this.app.stage.addChild(this.vegSprite);
    this.app.stage.addChild(this.trailLayer);
    this.app.stage.addChild(this.fadeOverlay);
    this.app.stage.addChild(this.legContainer);
    this.app.stage.addChild(this.shadowContainer);
    this.app.stage.addChild(this.herbivoreContainer);
    this.app.stage.addChild(this.scavengerContainer);
    this.app.stage.addChild(this.predatorContainer);
    this.app.stage.addChild(this.weatherLayer);
    this.app.stage.addChild(this.nightOverlay);

    // Create sprite pools
    this.herbPool = new SpritePool(this.textures.herbivore, this.herbivoreContainer);
    this.scavPool = new SpritePool(this.textures.scavenger, this.scavengerContainer);
    this.predPool = new SpritePool(this.textures.predator, this.predatorContainer);
    this.shadowPool = new SpritePool(this.textures.shadow, this.shadowContainer);
    this.legPool = new SpritePool(this.textures.leg, this.legContainer);
    this.legPool.preallocate(2400);

    // Pre-allocate for up to 1000 creatures to avoid runtime stalls
    this.herbPool.preallocate(800);
    this.predPool.preallocate(250);
    this.scavPool.preallocate(150);
    this.shadowPool.preallocate(1200);

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

    // Viewport culling bounds (in world coordinates)
    const zoom = camera?.zoom || 1;
    const cx = camera?.x || this.worldW / 2;
    const cy = camera?.y || this.worldH / 2;
    const halfW = (this.worldW / zoom) / 2;
    const halfH = (this.worldH / zoom) / 2;
    const margin = 100 / zoom;
    const cullLeft = (cx - halfW - margin) / scaleX;
    const cullRight = (cx + halfW + margin) / scaleX;
    const cullTop = (cy - halfH - margin) / scaleY;
    const cullBottom = (cy + halfH + margin) / scaleY;

    // LOD: skip per-creature effects when creatures are tiny on screen
    const creatureScreenPx = 4 * zoom;
    const lowDetail = creatureScreenPx < 4;

    // === 1. Background ===
    this.backgroundLayer.clear();
    this.backgroundLayer.rect(0, 0, this.worldW, this.worldH).fill({ color: 0x1a1510 });

    if (!state.config.wrapWorld) {
      this.backgroundLayer
        .rect(1, 1, this.worldW - 2, this.worldH - 2)
        .stroke({ color: 0x334455, width: 2, alpha: 0.6 });
    }

    const isDawn = state.dayPhase < 0.2;
    const isDusk = state.dayPhase > 0.55 && state.dayPhase < 0.75;

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
          .fill({ color: 0x6a8a5a, alpha: 0.12 });
      }
      for (let i = 0; i < state.predators.length; i++) {
        const p = state.predators[i];
        this.trailLayer
          .circle(p.pos.x * scaleX, p.pos.y * scaleY, 1)
          .fill({ color: 0x8a5040, alpha: 0.10 });
      }
      for (let i = 0; i < state.scavengers.length; i++) {
        const s = state.scavengers[i];
        this.trailLayer
          .circle(s.pos.x * scaleX, s.pos.y * scaleY, 1)
          .fill({ color: 0x9a8a40, alpha: 0.10 });
      }

      this.fadeOverlay.clear();
      this.fadeOverlay
        .rect(0, 0, this.worldW, this.worldH)
        .fill({ color: 0x1a1510, alpha: this.trailFadeAlpha });
    }

    // === 3. Release all pools ===
    this.herbPool.releaseAll();
    this.scavPool.releaseAll();
    this.predPool.releaseAll();
    this.shadowPool.releaseAll();
    this.legPool.releaseAll();

    // === 4. Terrain (cached) ===
    const currentEvent = state.activeEvent?.type || '';
    if (
      this.terrainDirty ||
      Math.abs(state.season - this.lastTerrainSeason) > 0.05 ||
      currentEvent !== this.lastTerrainEvent
    ) {
      this.renderTerrain(state);
      this.lastTerrainSeason = state.season;
      this.lastTerrainEvent = currentEvent;
    }

    // === 5. Vegetation overlay (update every 15 frames) ===
    this.vegUpdateCounter++;
    if (this.vegUpdateCounter >= 15) {
      this.updateVegetation(state);
      this.vegUpdateCounter = 0;
    }

    // === Corpses as ground stains ===
    for (let i = 0; i < state.corpses.length; i++) {
      const c = state.corpses[i];
      const sprite = this.shadowPool.acquire();
      sprite.x = c.x * scaleX;
      sprite.y = c.y * scaleY;
      sprite.tint = 0x553322; // dark brown-red
      const fadeRatio = c.decayTimer / c.maxDecay;
      sprite.alpha = fadeRatio * 0.4;
      sprite.scale.set(0.8);
    }

    // Shadow offset scales with sun angle (dawn/dusk = longer shadows)
    const sunProgress = (isDawn || isDusk)
      ? (isDawn ? (1 - state.dayPhase / 0.2) : ((state.dayPhase - 0.55) / 0.2))
      : 0;
    const shadowOffset = 2 + sunProgress * 3;

    // === 6. Herbivores ===
    for (let i = 0; i < state.herbivores.length; i++) {
      const h = state.herbivores[i];
      if (h.pos.x < cullLeft || h.pos.x > cullRight || h.pos.y < cullTop || h.pos.y > cullBottom) continue;
      const sprite = this.herbPool.acquire();

      sprite.x = h.pos.x * scaleX;
      sprite.y = h.pos.y * scaleY;
      const lineageTintH = hueShiftByLineage(HERB_SUBSPECIES[h.subspecies]?.hueBase || 0x5dd880, h.lineageId, HERB_SUBSPECIES[h.subspecies]?.hueRange || 20);
      sprite.tint = lineageTintH;
      sprite.rotation = Math.atan2(h.vel.y, h.vel.x);

      if (lowDetail) {
        sprite.scale.set(h.traits.size * scaleX * 0.28);
        sprite.alpha = 0.85;

        if (selectedIds && selectedIds.includes(h.id)) {
          const baseScale = h.traits.size * scaleX * 0.28;
          const ring = this.shadowPool.acquire();
          ring.x = sprite.x;
          ring.y = sprite.y;
          ring.tint = 0xffffff;
          ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
          ring.scale.set(baseScale * 5);
          const ring2 = this.shadowPool.acquire();
          ring2.x = sprite.x;
          ring2.y = sprite.y;
          ring2.tint = lineageTintH;
          ring2.alpha = 0.9;
          ring2.scale.set(baseScale * 3.5);
        }
      } else {
        // Age-based scale: young=0.6, old=0.9, else 1.0
        const ageRatio = h.age / h.maxAge;
        const ageSclMul = ageRatio < 0.15 ? 0.6 : ageRatio > 0.75 ? 0.9 : 1.0;
        const baseScale = h.traits.size * scaleX * 0.28 * ageSclMul;
        const velMagH = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
        const flexPhaseH = (time * Math.max(velMagH, 0) * 0.12 + h.id * 0.3) % (Math.PI * 2);
        const flexAmountH = velMagH > 5 ? 0.08 : 0;
        const scaleXBody = baseScale * (1 + Math.sin(flexPhaseH) * flexAmountH);
        const scaleYBody = baseScale * (1 - Math.sin(flexPhaseH) * flexAmountH * 0.5);
        sprite.scale.set(scaleXBody, scaleYBody);

        // Simplified matte alpha
        sprite.alpha = h.energy < 25 ? Math.max(0.5, h.energy / 25) * 0.9 : 0.9;

        // Ground shadow
        const shadowH = this.shadowPool.acquire();
        shadowH.x = sprite.x + shadowOffset;
        shadowH.y = sprite.y + shadowOffset;
        shadowH.rotation = sprite.rotation;
        shadowH.scale.set(baseScale * 1.1);
        shadowH.alpha = 0.3;
        this.renderLegs(sprite.x, sprite.y, sprite.rotation, velMagH, h.traits.size, time, h.id, sprite.tint, scaleX);

        if (selectedIds && selectedIds.includes(h.id)) {
          const ring = this.shadowPool.acquire();
          ring.x = sprite.x;
          ring.y = sprite.y;
          ring.tint = 0xffffff;
          ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
          ring.scale.set(baseScale * 5);
          const ring2 = this.shadowPool.acquire();
          ring2.x = sprite.x;
          ring2.y = sprite.y;
          ring2.tint = lineageTintH;
          ring2.alpha = 0.9;
          ring2.scale.set(baseScale * 3.5);
        }
      }
    }

    // === 7. Predators ===
    for (let i = 0; i < state.predators.length; i++) {
      const p = state.predators[i];
      if (p.pos.x < cullLeft || p.pos.x > cullRight || p.pos.y < cullTop || p.pos.y > cullBottom) continue;
      const sprite = this.predPool.acquire();

      sprite.x = p.pos.x * scaleX;
      sprite.y = p.pos.y * scaleY;
      const lineageTintP = hueShiftByLineage(PRED_SUBSPECIES[p.subspecies]?.hueBase || 0xe87744, p.lineageId, PRED_SUBSPECIES[p.subspecies]?.hueRange || 20);
      sprite.tint = lineageTintP;
      sprite.rotation = Math.atan2(p.vel.y, p.vel.x);

      if (lowDetail) {
        sprite.scale.set(p.traits.size * scaleX * 0.28);
        sprite.alpha = 0.85;

        if (selectedIds && selectedIds.includes(p.id)) {
          const baseScale = p.traits.size * scaleX * 0.28;
          const ring = this.shadowPool.acquire();
          ring.x = sprite.x;
          ring.y = sprite.y;
          ring.tint = 0xffffff;
          ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
          ring.scale.set(baseScale * 5);
          const ring2 = this.shadowPool.acquire();
          ring2.x = sprite.x;
          ring2.y = sprite.y;
          ring2.tint = lineageTintP;
          ring2.alpha = 0.9;
          ring2.scale.set(baseScale * 3.5);
        }
      } else {
        // Age-based scale
        const ageRatio = p.age / p.maxAge;
        const ageSclMul = ageRatio < 0.15 ? 0.6 : ageRatio > 0.75 ? 0.9 : 1.0;
        const baseScale = p.traits.size * scaleX * 0.28 * ageSclMul;
        const velMagP = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
        const flexPhaseP = (time * Math.max(velMagP, 0) * 0.12 + p.id * 0.3) % (Math.PI * 2);
        const flexAmountP = velMagP > 5 ? 0.10 : 0;
        const scaleXBodyP = baseScale * (1 + Math.sin(flexPhaseP) * flexAmountP);
        const scaleYBodyP = baseScale * (1 - Math.sin(flexPhaseP) * flexAmountP * 0.5);
        sprite.scale.set(scaleXBodyP, scaleYBodyP);

        // Simplified matte alpha
        sprite.alpha = p.energy < 25 ? Math.max(0.5, p.energy / 25) * 0.9 : 0.9;

        // Ground shadow
        const shadowP = this.shadowPool.acquire();
        shadowP.x = sprite.x + shadowOffset;
        shadowP.y = sprite.y + shadowOffset;
        shadowP.rotation = sprite.rotation;
        shadowP.scale.set(baseScale * 1.1);
        shadowP.alpha = 0.3;
        this.renderLegs(sprite.x, sprite.y, sprite.rotation, velMagP, p.traits.size, time, p.id, sprite.tint, scaleX);

        if (selectedIds && selectedIds.includes(p.id)) {
          const ring = this.shadowPool.acquire();
          ring.x = sprite.x;
          ring.y = sprite.y;
          ring.tint = 0xffffff;
          ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
          ring.scale.set(baseScale * 5);
          const ring2 = this.shadowPool.acquire();
          ring2.x = sprite.x;
          ring2.y = sprite.y;
          ring2.tint = lineageTintP;
          ring2.alpha = 0.9;
          ring2.scale.set(baseScale * 3.5);
        }
      }
    }

    // === 8. Scavengers ===
    for (let i = 0; i < state.scavengers.length; i++) {
      const s = state.scavengers[i];
      if (s.pos.x < cullLeft || s.pos.x > cullRight || s.pos.y < cullTop || s.pos.y > cullBottom) continue;
      const sprite = this.scavPool.acquire();
      sprite.x = s.pos.x * scaleX;
      sprite.y = s.pos.y * scaleY;
      const lineageTintS = hueShiftByLineage(SCAV_SUBSPECIES[s.subspecies]?.hueBase || 0xd4a840, s.lineageId, SCAV_SUBSPECIES[s.subspecies]?.hueRange || 20);
      sprite.tint = lineageTintS;
      sprite.rotation = Math.atan2(s.vel.y, s.vel.x);

      if (lowDetail) {
        sprite.scale.set(s.traits.size * scaleX * 0.28);
        sprite.alpha = 0.85;

        if (selectedIds && selectedIds.includes(s.id)) {
          const baseScale = s.traits.size * scaleX * 0.28;
          const ring = this.shadowPool.acquire();
          ring.x = sprite.x;
          ring.y = sprite.y;
          ring.tint = 0xffffff;
          ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
          ring.scale.set(baseScale * 5);
          const ring2 = this.shadowPool.acquire();
          ring2.x = sprite.x;
          ring2.y = sprite.y;
          ring2.tint = lineageTintS;
          ring2.alpha = 0.9;
          ring2.scale.set(baseScale * 3.5);
        }
      } else {
        // Age-based scale
        const ageRatio = s.age / s.maxAge;
        const ageSclMul = ageRatio < 0.15 ? 0.6 : ageRatio > 0.75 ? 0.9 : 1.0;
        const baseScale = s.traits.size * scaleX * 0.28 * ageSclMul;
        const velMagS = Math.sqrt(s.vel.x * s.vel.x + s.vel.y * s.vel.y);
        const flexPhaseS = (time * Math.max(velMagS, 0) * 0.12 + s.id * 0.3) % (Math.PI * 2);
        const flexAmountS = velMagS > 5 ? 0.08 : 0;
        const scaleXBodyS = baseScale * (1 + Math.sin(flexPhaseS) * flexAmountS);
        const scaleYBodyS = baseScale * (1 - Math.sin(flexPhaseS) * flexAmountS * 0.5);
        sprite.scale.set(scaleXBodyS, scaleYBodyS);

        // Simplified matte alpha
        sprite.alpha = s.energy < 25 ? Math.max(0.5, s.energy / 25) * 0.9 : 0.9;

        // Ground shadow
        const shadowS = this.shadowPool.acquire();
        shadowS.x = sprite.x + shadowOffset;
        shadowS.y = sprite.y + shadowOffset;
        shadowS.rotation = sprite.rotation;
        shadowS.scale.set(baseScale * 1.0);
        shadowS.alpha = 0.3;
        this.renderLegs(sprite.x, sprite.y, sprite.rotation, velMagS, s.traits.size, time, s.id, sprite.tint, scaleX);

        if (selectedIds && selectedIds.includes(s.id)) {
          const ring = this.shadowPool.acquire();
          ring.x = sprite.x;
          ring.y = sprite.y;
          ring.tint = 0xffffff;
          ring.alpha = 0.7 + 0.3 * Math.sin(time * 4);
          ring.scale.set(baseScale * 5);
          const ring2 = this.shadowPool.acquire();
          ring2.x = sprite.x;
          ring2.y = sprite.y;
          ring2.tint = lineageTintS;
          ring2.alpha = 0.9;
          ring2.scale.set(baseScale * 3.5);
        }
      }
    }

    // === Weather visuals ===
    this.weatherLayer.clear();
    if (this.weatherEnabled && state.weather.type !== 'clear' && state.weather.intensity > 0.01) {
      const wi = state.weather.intensity;

      if (state.weather.type === 'rain') {
        this.weatherLayer
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0x223355, alpha: wi * 0.15 });
      }

      if (state.weather.type === 'fog') {
        this.weatherLayer
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0xccccbb, alpha: wi * 0.12 });
        const fogCount = Math.floor(2 + wi * 3);
        for (let f = 0; f < fogCount; f++) {
          const seed = f * 137.5;
          const fogX = ((seed * 7 + time * 3) % this.worldW);
          const fogY = ((seed * 11 + time * 2) % this.worldH);
          this.weatherLayer
            .circle(fogX, fogY, 80 + wi * 60)
            .fill({ color: 0xddddcc, alpha: wi * 0.08 });
        }
      }

      if (state.weather.type === 'wind') {
        this.weatherLayer
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0xaaaaaa, alpha: wi * 0.04 });
      }
    }

    // === Night overlay ===
    this.nightOverlay.clear();
    if (this.dayNightEnabled) {
      const nightAlpha = getNightAlpha(state.dayPhase);
      if (nightAlpha > 0.01) {
        this.nightOverlay
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0x0a0a15, alpha: nightAlpha });
      }
    }
  }

  private renderLegs(
    x: number, y: number, rotation: number,
    speed: number, size: number, time: number, id: number,
    tint: number, scaleX: number,
  ): void {
    if (speed < 5) return; // No legs when nearly stationary

    const phase = (time * speed * 0.15 + id * 0.5) % (Math.PI * 2);
    const legSpread = size * scaleX * 0.15;
    const legStride = size * scaleX * 0.08;

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const perpX = -sin;
    const perpY = cos;
    const paraX = cos;
    const paraY = sin;

    for (let pair = 0; pair < 2; pair++) {
      const pairPhase = phase + pair * Math.PI;
      const stride = Math.sin(pairPhase) * legStride;
      const offset = (pair - 0.5) * legSpread * 2;

      const leg1 = this.legPool.acquire();
      leg1.x = x + perpX * legSpread + paraX * (offset + stride);
      leg1.y = y + perpY * legSpread + paraY * (offset + stride);
      leg1.tint = tint;
      leg1.alpha = 0.7;
      leg1.scale.set(size * scaleX * 0.12);

      const leg2 = this.legPool.acquire();
      leg2.x = x - perpX * legSpread + paraX * (offset - stride);
      leg2.y = y - perpY * legSpread + paraY * (offset - stride);
      leg2.tint = tint;
      leg2.alpha = 0.7;
      leg2.scale.set(size * scaleX * 0.12);
    }
  }

  private updateVegetation(state: SimState): void {
    if (!this.vegCanvas || !this.vegCtx) return;
    const ctx = this.vegCtx;
    const w = this.vegCanvas.width;
    const h = this.vegCanvas.height;
    const config = state.config;
    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cellW = w / cols;
    const cellH = h / rows;

    // Clear to white (neutral for multiply blend)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const density = state.plantGrid[idx] / config.plantCarryingCapacity;
        if (density < 0.05) continue;

        // Skip water and mountain cells
        const terrain = state.terrain[idx];
        if (terrain === 1 || terrain === 3) continue;

        const green = Math.floor(80 + density * 120);
        const red = Math.floor(60 + (1 - density) * 60);
        const alpha = density * 0.5;

        ctx.fillStyle = `rgba(${red}, ${green}, 40, ${alpha})`;
        ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
      }
    }

    // Refresh the pixi texture from canvas
    if (this.vegSprite) {
      this.vegSprite.texture.source.update();
    }
  }

  private renderTerrain(state: SimState): void {
    if (!this.terrainCanvas || !this.terrainCtx) return;
    const w = this.terrainCanvas.width;
    const h = this.terrainCanvas.height;
    const imageData = this.terrainCtx.createImageData(w, h);
    paintTerrain(imageData, w, h, state, state.season);
    this.terrainCtx.putImageData(imageData, 0, 0);

    // Update the terrain sprite's texture from canvas
    if (this.terrainSprite) {
      if (this.terrainSprite.texture && this.terrainSprite.texture !== Texture.EMPTY) {
        this.terrainSprite.texture.destroy(true);
      }
      this.terrainSprite.texture = Texture.from(this.terrainCanvas);
      // Scale up from half-res canvas to full world size
      this.terrainSprite.width = this.worldW;
      this.terrainSprite.height = this.worldH;
    }
    this.terrainDirty = false;
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
    if (this.terrainCanvas) {
      this.terrainCanvas.width = Math.ceil(width * 0.5);
      this.terrainCanvas.height = Math.ceil(height * 0.5);
    }
    if (this.vegCanvas) {
      this.vegCanvas.width = width;
      this.vegCanvas.height = height;
      this.vegUpdateCounter = 15; // force refresh
    }
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
