# Satellite Graphics Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the ecosystem simulator from abstract neon-glow sprites to an illustrated/painted satellite view with natural terrain, matte creatures, and subtle animations.

**Architecture:** Replace the current flat-color terrain tiles with a noise-painted RenderTexture using the existing value noise system. Replace individual plant sprites with a vegetation density overlay. Remove glow/particle effects. Add leg movement and body flex animations to creature sprites. Weather becomes terrain tint changes instead of particle effects.

**Tech Stack:** PixiJS v8, TypeScript, Vite, existing value noise (`src/sim/terrain.ts`)

---

### Task 1: Noise-Painted Terrain Texture

Replace the current flat-colored grid terrain (`renderTerrain` in `src/render/renderer.ts:989-1061`) with a noise-painted fullscreen texture that blends biome colors naturally.

**Files:**
- Create: `src/render/terrain-painter.ts`
- Modify: `src/render/renderer.ts:989-1061` (replace `renderTerrain`)
- Reference: `src/sim/terrain.ts` (existing noise functions)

**Step 1: Create `src/render/terrain-painter.ts`**

This module generates pixel data for a Canvas, which is then used as a PixiJS texture. It samples the terrain grid and applies noise-based color variation within each biome.

```typescript
import type { SimState } from '../sim/types';
import { TerrainType } from '../sim/types';

// Biome color palettes [base, variation] as RGB arrays
const BIOME_COLORS: Record<number, { base: [number, number, number]; alt: [number, number, number] }> = {
  [TerrainType.Land]:     { base: [196, 168, 130], alt: [139, 125, 94] },   // sandy tan to olive-brown
  [TerrainType.Fertile]:  { base: [92, 122, 61],   alt: [61, 92, 42] },     // rich earth to mossy green
  [TerrainType.Water]:    { base: [42, 107, 107],   alt: [26, 69, 69] },     // deep teal to dark blue-green
  [TerrainType.Mountain]: { base: [140, 140, 140],  alt: [90, 90, 90] },     // cool grey to slate
};

// Seasonal tint multipliers [r, g, b] — applied as multiply blend
const SEASON_TINTS: [number, number, number][] = [
  [0.95, 1.08, 0.95],  // Spring: slight green boost
  [1.06, 1.02, 0.90],  // Summer: warm yellow
  [1.08, 0.95, 0.85],  // Autumn: amber/orange
  [0.90, 0.92, 1.05],  // Winter: desaturated blue-grey
];

// Simple hash noise for micro-texture (same algorithm as terrain.ts)
function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hashNoise(ix, iy, seed);
  const n10 = hashNoise(ix + 1, iy, seed);
  const n01 = hashNoise(ix, iy + 1, seed);
  const n11 = hashNoise(ix + 1, iy + 1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function lerpRGB(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Paint terrain onto a canvas ImageData buffer.
 * Pixel-level: samples terrain grid, applies noise variation + distance-field blending.
 */
export function paintTerrain(
  imageData: ImageData,
  width: number,
  height: number,
  state: SimState,
  season: number,
): void {
  const { terrain, config } = state;
  const cols = config.plantGridCols;
  const rows = config.plantGridRows;
  const cellW = width / cols;
  const cellH = height / rows;
  const data = imageData.data;
  const seed = config.seed;

  // Seasonal tint
  const seasonIdx = season * 4;
  const si0 = Math.floor(seasonIdx) % 4;
  const si1 = (si0 + 1) % 4;
  const sf = seasonIdx - Math.floor(seasonIdx);
  const ss = sf * sf * (3 - 2 * sf); // smoothstep
  const tint: [number, number, number] = [
    SEASON_TINTS[si0][0] + (SEASON_TINTS[si1][0] - SEASON_TINTS[si0][0]) * ss,
    SEASON_TINTS[si0][1] + (SEASON_TINTS[si1][1] - SEASON_TINTS[si0][1]) * ss,
    SEASON_TINTS[si0][2] + (SEASON_TINTS[si1][2] - SEASON_TINTS[si0][2]) * ss,
  ];

  for (let py = 0; py < height; py++) {
    const gridY = py / cellH;
    const gy = Math.floor(gridY);
    const fy = gridY - gy; // fractional position within cell

    for (let px = 0; px < width; px++) {
      const gridX = px / cellW;
      const gx = Math.floor(gridX);
      const fx = gridX - gx; // fractional position within cell

      // Get terrain type at this cell
      const clampedGx = Math.min(gx, cols - 1);
      const clampedGy = Math.min(gy, rows - 1);
      const idx = clampedGy * cols + clampedGx;
      const terrainType = terrain[idx];

      // Get biome colors
      const biome = BIOME_COLORS[terrainType] || BIOME_COLORS[TerrainType.Land];

      // Multi-octave noise for natural color variation
      const nx = px / width;
      const ny = py / height;
      const n1 = valueNoise(nx * 20, ny * 20, seed + 100);
      const n2 = valueNoise(nx * 40, ny * 40, seed + 200) * 0.5;
      const n3 = valueNoise(nx * 80, ny * 80, seed + 300) * 0.25;
      const noiseVal = (n1 + n2 + n3) / 1.75; // normalized 0-1

      // Blend between base and alt color using noise
      let color = lerpRGB(biome.base, biome.alt, noiseVal);

      // Distance-field blending at biome borders
      // Check if any neighbor has a different terrain type
      const checkBlend = (dx: number, dy: number): number | null => {
        const nx = clampedGx + dx;
        const ny = clampedGy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return null;
        const neighborType = terrain[ny * cols + nx];
        if (neighborType !== terrainType) return neighborType;
        return null;
      };

      // Smooth blending at edges using fractional position
      const blendRadius = 0.35; // how far into cell the blend extends
      let blendColor: [number, number, number] | null = null;
      let blendAmount = 0;

      // Check 4-connected neighbors for blending
      if (fx < blendRadius) {
        const neighbor = checkBlend(-1, 0);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
          blendAmount = (blendRadius - fx) / blendRadius;
        }
      }
      if (fx > 1 - blendRadius) {
        const neighbor = checkBlend(1, 0);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          const amt = (fx - (1 - blendRadius)) / blendRadius;
          if (amt > blendAmount) {
            blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
            blendAmount = amt;
          }
        }
      }
      if (fy < blendRadius) {
        const neighbor = checkBlend(0, -1);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          const amt = (blendRadius - fy) / blendRadius;
          if (amt > blendAmount) {
            blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
            blendAmount = amt;
          }
        }
      }
      if (fy > 1 - blendRadius) {
        const neighbor = checkBlend(0, 1);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          const amt = (fy - (1 - blendRadius)) / blendRadius;
          if (amt > blendAmount) {
            blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
            blendAmount = amt;
          }
        }
      }

      if (blendColor && blendAmount > 0) {
        // Smoothstep the blend
        const s = blendAmount * blendAmount * (3 - 2 * blendAmount);
        color = lerpRGB(color, blendColor, s * 0.5);
      }

      // Apply seasonal tint
      const pixIdx = (py * width + px) * 4;
      data[pixIdx]     = Math.min(255, Math.max(0, Math.round(color[0] * tint[0])));
      data[pixIdx + 1] = Math.min(255, Math.max(0, Math.round(color[1] * tint[1])));
      data[pixIdx + 2] = Math.min(255, Math.max(0, Math.round(color[2] * tint[2])));
      data[pixIdx + 3] = 255;
    }
  }
}
```

**Step 2: Update `renderTerrain` in `src/render/renderer.ts`**

Replace the existing `renderTerrain` method to use the new canvas-based painter. Add a 2D canvas for pixel manipulation, paint to it, then upload to a PixiJS texture.

Add to class fields (around line 173-179):
```typescript
private terrainCanvas: HTMLCanvasElement | null = null;
private terrainCtx: CanvasRenderingContext2D | null = null;
```

In `init()` (after terrainTexture creation, ~line 243):
```typescript
// Create offscreen canvas for terrain painting
this.terrainCanvas = document.createElement('canvas');
this.terrainCanvas.width = options.width;
this.terrainCanvas.height = options.height;
this.terrainCtx = this.terrainCanvas.getContext('2d')!;
```

Replace `renderTerrain` method entirely:
```typescript
private renderTerrain(state: SimState): void {
  if (!this.terrainCanvas || !this.terrainCtx) return;
  const w = this.terrainCanvas.width;
  const h = this.terrainCanvas.height;
  const imageData = this.terrainCtx.createImageData(w, h);
  paintTerrain(imageData, w, h, state, state.season);
  this.terrainCtx.putImageData(imageData, 0, 0);

  // Upload canvas to PixiJS texture
  if (this.terrainTexture) {
    this.terrainTexture.destroy();
  }
  this.terrainTexture = Texture.from(this.terrainCanvas) as any;
  if (this.terrainSprite) {
    this.terrainSprite.texture = this.terrainTexture;
  }
  this.terrainDirty = false;
}
```

In `resize()`, also resize the canvas:
```typescript
if (this.terrainCanvas) {
  this.terrainCanvas.width = width;
  this.terrainCanvas.height = height;
}
```

Remove the old `terrainGraphics` field and its usage. Remove the `waterOverlay` Graphics and `renderWaterOverlay` method — water is now part of the painted terrain.

**Step 3: Remove old terrain-related code**

- Remove `this.terrainGraphics` field and its creation
- Remove `this.waterOverlay` field, its creation, and `addChild` call
- Remove `this.waterFrame` field
- Remove `renderWaterOverlay` method entirely
- Remove the `waterOverlay` reference from `app.stage.addChild` calls in `init()`
- Remove the water shimmer block (lines ~454-457)

**Step 4: Update background layer**

Replace the complex seasonal background color logic (lines 347-391) with a simple clear since the terrain texture now covers the full background:

```typescript
// === 1. Background ===
this.backgroundLayer.clear();
this.backgroundLayer.rect(0, 0, this.worldW, this.worldH).fill({ color: 0x1a1a1a });
```

Remove `SEASON_COLORS` array and `lerpColor` function from the top of the file — seasonal color is now handled by the terrain painter.

Remove the dawn/dusk warm tint gradient bands (lines 370-385) — handled by seasonal tinting in terrain painter.

**Step 5: Verify and commit**

Run: `npm run dev`
Expected: Terrain renders as a smooth, painted landscape with natural biome colors, smooth shoreline blending, and seasonal tinting. No hard grid edges.

```bash
git add src/render/terrain-painter.ts src/render/renderer.ts
git commit -m "feat(graphics): noise-painted terrain texture with biome blending"
```

---

### Task 2: Vegetation Density Overlay

Replace individual plant sprites with a density-based terrain overlay that shows vegetation as green tinting over the base terrain.

**Files:**
- Modify: `src/render/renderer.ts` (remove plant rendering, add vegetation overlay)

**Step 1: Add vegetation overlay canvas**

Add to class fields:
```typescript
private vegCanvas: HTMLCanvasElement | null = null;
private vegCtx: CanvasRenderingContext2D | null = null;
private vegTexture: RenderTexture | null = null;
private vegSprite: Sprite | null = null;
private vegUpdateCounter: number = 0;
```

In `init()` after terrain canvas setup:
```typescript
// Vegetation overlay
this.vegCanvas = document.createElement('canvas');
this.vegCanvas.width = options.width;
this.vegCanvas.height = options.height;
this.vegCtx = this.vegCanvas.getContext('2d')!;
this.vegSprite = Sprite.from(this.vegCanvas);
this.vegSprite.blendMode = 'multiply';
this.vegSprite.alpha = 0.6;
```

Add `this.vegSprite` to stage z-order right after the terrain sprite (before creatures).

**Step 2: Add vegetation update method**

```typescript
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

  // Clear to neutral (white = no tint when using multiply blend)
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

      // Green tint proportional to density
      const green = Math.floor(80 + density * 120); // 80-200
      const red = Math.floor(60 + (1 - density) * 60);   // exposed earth when sparse
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
```

**Step 3: Call vegetation update in render loop**

In the `render` method, replace the entire plant rendering block (section 5, lines ~460-491) with:

```typescript
// === 5. Vegetation overlay (update every 15 frames) ===
this.vegUpdateCounter++;
if (this.vegUpdateCounter >= 15) {
  this.updateVegetation(state);
  this.vegUpdateCounter = 0;
}
```

**Step 4: Remove plant pool and container**

- Remove `plantContainer` field and creation
- Remove `plantPool` field and creation
- Remove `plantContainer` from stage `addChild` calls
- Remove `this.plantPool.releaseAll()` from the pool release block
- Remove plant rendering wind sway code

Note: Keep the `plantPool` temporarily for corpse rendering (will be changed in Task 5).

**Step 5: Update resize to handle veg canvas**

In `resize()`:
```typescript
if (this.vegCanvas) {
  this.vegCanvas.width = width;
  this.vegCanvas.height = height;
  this.vegUpdateCounter = 15; // force refresh
}
```

**Step 6: Verify and commit**

Run: `npm run dev`
Expected: Vegetation appears as green patches over terrain, denser where plant density is high. Grazing trails visible as earth-colored paths through green areas.

```bash
git add src/render/renderer.ts
git commit -m "feat(graphics): vegetation density overlay replaces plant sprites"
```

---

### Task 3: Matte Creature Visuals (Remove Glows)

Remove glow halos, bloom filter, and neon coloring. Desaturate creature colors to earthy tones.

**Files:**
- Modify: `src/render/renderer.ts` (creature rendering sections)
- Modify: `src/render/textures.ts` (remove glow texture, update shadow)
- Modify: `src/sim/subspecies.ts` (update hue base colors to earthy tones)

**Step 1: Update subspecies colors in `src/sim/subspecies.ts`**

Change `hueBase` values to matte, earthy tones:

```typescript
// HERB_SUBSPECIES
{ name: 'Grazer',  hueBase: 0x7a9a6a, ... }  // earth-green (was 0x44ccaa)
{ name: 'Forager', hueBase: 0x9aaa5a, ... }  // yellow-green (was 0x88dd44)

// PRED_SUBSPECIES
{ name: 'Stalker',     hueBase: 0xa06040, ... }  // rust-brown (was 0xee6644)
{ name: 'Pack Hunter', hueBase: 0x7a4060, ... }  // dark purple-brown (was 0xcc44aa)

// SCAV_SUBSPECIES
{ name: 'Vulture', hueBase: 0xb0a050, ... }  // dusty yellow (was 0xddcc55)
{ name: 'Beetle',  hueBase: 0x6a5030, ... }  // dark brown (was 0xaa7722)
```

**Step 2: Remove glow pool, container, and bloom filter**

In `src/render/renderer.ts`:
- Remove `glowContainer` field and creation
- Remove `glowPool` field and creation
- Remove `glowPool.preallocate(1200)`
- Remove `this.glowContainer.filters = [new BlurFilter(...)]`
- Remove `this.glowContainer.blendMode = 'add'`
- Remove `import { BlurFilter }` (if only used here)
- Remove `glowContainer` from stage `addChild`
- Remove `this.glowPool.releaseAll()` from pool release block

**Step 3: Remove all glow sprite rendering from creature loops**

In herbivore loop (lines ~562-569): Remove the `glowH` block (lineage glow).
In predator loop (lines ~642-649): Remove the `glowP` block.
In scavenger loop (lines ~716-723): Remove the `glowS` block.

Keep the selection ring indicator but change it to use the shadow pool or a simple ring:
```typescript
if (selectedIds && selectedIds.includes(h.id)) {
  const ring = this.shadowPool.acquire();
  ring.x = sprite.x;
  ring.y = sprite.y;
  ring.tint = 0xffffff;
  ring.alpha = 0.5 + 0.3 * Math.sin(time * 4);
  ring.scale.set(baseScale * 3);
}
```

**Step 4: Simplify creature alpha**

Replace vision-based alpha calculations with simple solid alpha:
```typescript
sprite.alpha = h.energy < 25 ? Math.max(0.5, h.energy / 25) * 0.9 : 0.9;
```

Remove `nightGlowBoost` variable and `getLifeVisuals` function (no longer needed for glow alpha). Keep life visual scale/tint effects if desired, or simplify to just age-based scale.

**Step 5: Remove ambient particle system**

Remove:
- `AmbientParticle` interface
- `ambientParticles` and `ambientSprites` arrays
- All ambient particle spawning code (section "Ambient particles", lines ~813-895)
- `particleContainer` and `particlePool` (will be fully removed in Task 5)
- `particleContainer.blendMode = 'add'`

**Step 6: Remove `hueShiftByLineage` desaturation**

The `hueShiftByLineage` function can stay (it provides lineage color variation), but reduce the `hueRange` values in subspecies definitions to tighter ranges (e.g., 10 instead of 20) for more natural variation.

**Step 7: Remove helper functions no longer needed**

- Remove `getLifeVisuals` function (or simplify to just scale)
- Remove `nightGlowBoost` calculation from render method

**Step 8: Verify and commit**

Run: `npm run dev`
Expected: Creatures appear as matte, earthy-colored shapes. No glowing halos. No bloom effect. No ambient particles. Selected creatures have a subtle white ring.

```bash
git add src/render/renderer.ts src/render/textures.ts src/sim/subspecies.ts
git commit -m "feat(graphics): matte creature visuals, remove glows and particles"
```

---

### Task 4: Creature Leg Movement Animation

Add tiny alternating leg dots that oscillate based on movement speed.

**Files:**
- Modify: `src/render/renderer.ts` (creature rendering loops)
- Modify: `src/render/textures.ts` (add leg dot texture)

**Step 1: Add leg dot texture in `src/render/textures.ts`**

```typescript
// Leg dot: tiny circle for leg animation
const legG = new Graphics();
legG.circle(0, 0, 1.5);
legG.fill({ color: 0xffffff });
const leg = app.renderer.generateTexture({ target: legG, resolution: 2 });
legG.destroy();
```

Add `leg: Texture` to `GeneratedTextures` interface and return value.

**Step 2: Add leg pool in renderer**

Add fields:
```typescript
private legContainer: Container;
private legPool!: SpritePool;
```

In constructor: `this.legContainer = new Container();`

In `init()`:
```typescript
this.legPool = new SpritePool(this.textures.leg, this.legContainer);
this.legPool.preallocate(2400); // 2 legs per creature * ~1200
```

Add `this.legContainer` to stage z-order just before creature containers (after shadows).

In pool release block: `this.legPool.releaseAll();`

**Step 3: Add leg rendering helper**

```typescript
private renderLegs(
  x: number, y: number, rotation: number,
  speed: number, size: number, time: number, id: number,
  tint: number, scaleX: number,
): void {
  // Movement phase — advances with speed
  const velMag = speed;
  if (velMag < 5) return; // No legs when nearly stationary

  const phase = (time * velMag * 0.15 + id * 0.5) % (Math.PI * 2);
  const legSpread = size * scaleX * 0.15; // How far legs are from body center
  const legStride = size * scaleX * 0.08; // How far legs move forward/back

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // Perpendicular to movement direction
  const perpX = -sin;
  const perpY = cos;
  // Along movement direction
  const paraX = cos;
  const paraY = sin;

  // 2 pairs of legs, alternating
  for (let pair = 0; pair < 2; pair++) {
    const pairPhase = phase + pair * Math.PI; // alternating
    const stride = Math.sin(pairPhase) * legStride;
    const offset = (pair - 0.5) * legSpread * 2; // front/back pair position

    // Left leg
    const leg1 = this.legPool.acquire();
    leg1.x = x + perpX * legSpread + paraX * (offset + stride);
    leg1.y = y + perpY * legSpread + paraY * (offset + stride);
    leg1.tint = tint;
    leg1.alpha = 0.7;
    leg1.scale.set(size * scaleX * 0.12);

    // Right leg
    const leg2 = this.legPool.acquire();
    leg2.x = x - perpX * legSpread + paraX * (offset - stride);
    leg2.y = y - perpY * legSpread + paraY * (offset - stride);
    leg2.tint = tint;
    leg2.alpha = 0.7;
    leg2.scale.set(size * scaleX * 0.12);
  }
}
```

**Step 4: Call leg rendering in each creature loop**

In each creature rendering loop (herbivore, predator, scavenger), after positioning the body sprite but in the non-lowDetail branch, add:

```typescript
// Leg animation
const velMag = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
this.renderLegs(sprite.x, sprite.y, sprite.rotation, velMag, h.traits.size, time, h.id, sprite.tint, scaleX);
```

**Step 5: Verify and commit**

Run: `npm run dev`
Expected: Moving creatures have tiny alternating leg dots that cycle with their movement speed. Stationary creatures show no legs.

```bash
git add src/render/renderer.ts src/render/textures.ts
git commit -m "feat(graphics): creature leg movement animation"
```

---

### Task 5: Body Flex Animation + Simplified Death/Corpse Effects

Add body squish/stretch along movement axis. Simplify death to a brief flash, birth to nothing, corpses to ground stains.

**Files:**
- Modify: `src/render/renderer.ts` (creature scale, death/birth events, corpse rendering)

**Step 1: Body flex animation**

In each creature's non-lowDetail rendering branch, replace the existing breathe/prowl animation with body flex:

For herbivores:
```typescript
const velMag = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
const flexPhase = (time * Math.max(velMag, 0) * 0.12 + h.id * 0.3) % (Math.PI * 2);
const flexAmount = velMag > 5 ? 0.08 : 0; // Only flex when moving
const scaleXBody = baseScale * (1 + Math.sin(flexPhase) * flexAmount);
const scaleYBody = baseScale * (1 - Math.sin(flexPhase) * flexAmount * 0.5);
sprite.scale.set(scaleXBody, scaleYBody);
```

Similar for predators and scavengers (predators can have slightly more flex: 0.10).

**Step 2: Replace death event particles**

Replace the death particle burst (lines ~749-768) with a brief flash:

```typescript
if (ev.type === 'death') {
  // Brief red-brown flash — rendered as a temporary tinted shadow sprite
  const flash = this.shadowPool.acquire();
  flash.x = ex;
  flash.y = ey;
  flash.tint = 0x884433;
  flash.alpha = 0.6;
  flash.scale.set(1.5);
  // Flash fades quickly (handled by being released next frame via pool)
}
```

**Step 3: Remove birth event particles**

Remove the birth sparkle burst entirely (lines ~769-789). No visual for births.

```typescript
// Birth: no visual effect (creature just appears)
```

**Step 4: Update corpse rendering**

Replace current corpse rendering (lines ~494-502) with ground stain:

```typescript
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
```

**Step 5: Remove particle system entirely**

Now that death/birth don't use particles and ambient particles were removed in Task 3:
- Remove `ActiveParticle` interface
- Remove `particles` array
- Remove `particleContainer` and `particlePool`
- Remove all particle update code (section 9, lines ~793-811)
- Remove particle-related cleanup in `resize()` and `destroy()`

**Step 6: Verify and commit**

Run: `npm run dev`
Expected: Moving creatures show subtle body flex. Death shows brief dark flash. Corpses are fading brown ground stains. No particle effects anywhere.

```bash
git add src/render/renderer.ts
git commit -m "feat(graphics): body flex animation, simplified death/corpse effects"
```

---

### Task 6: Weather as Terrain Tint + Night Simplification

Replace weather particles (rain lines, wind streaks) with terrain color changes. Simplify night overlay.

**Files:**
- Modify: `src/render/renderer.ts` (weather section, night section)

**Step 1: Replace weather visuals**

Replace the entire weather rendering block (lines ~898-962) with terrain tint overlays:

```typescript
// === Weather as terrain color modification ===
this.weatherLayer.clear();
if (this.weatherEnabled && state.weather.type !== 'clear' && state.weather.intensity > 0.01) {
  const wi = state.weather.intensity;

  if (state.weather.type === 'rain') {
    // Darken terrain with blue tint
    this.weatherLayer
      .rect(0, 0, this.worldW, this.worldH)
      .fill({ color: 0x223355, alpha: wi * 0.15 });
  }

  if (state.weather.type === 'fog') {
    // Large soft grey patches
    this.weatherLayer
      .rect(0, 0, this.worldW, this.worldH)
      .fill({ color: 0xccccbb, alpha: wi * 0.12 });

    // A few large fog blobs
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
    // Subtle directional brightness gradient — no wind streaks
    const windAngle = state.weather.windAngle;
    this.weatherLayer
      .rect(0, 0, this.worldW, this.worldH)
      .fill({ color: 0xaaaaaa, alpha: wi * 0.04 });
  }
}
```

**Step 2: Simplify night overlay**

Replace the night rendering (lines ~965-986) — remove stars, keep just the darkening:

```typescript
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
```

**Step 3: Remove fog glow sprite usage**

The old fog code used `this.glowPool.acquire()` for volumetric blobs — this was already removed with the glow pool in Task 3. Just verify no references remain.

**Step 4: Verify and commit**

Run: `npm run dev`
Expected: Rain shows as subtle blue darkening. Fog as soft grey patches. Wind as barely perceptible brightness shift. Night is smooth darkening with no stars.

```bash
git add src/render/renderer.ts
git commit -m "feat(graphics): weather as terrain tints, simplified night"
```

---

### Task 7: Texture Updates + Final Cleanup

Update creature textures for satellite style, remove unused code, update minimap colors.

**Files:**
- Modify: `src/render/textures.ts` (remove glow texture, keep shadow)
- Modify: `src/render/renderer.ts` (final cleanup)
- Modify: `src/ui/minimap.ts` (update colors to match new palette)

**Step 1: Clean up textures**

In `src/render/textures.ts`:
- Remove `glow` from `GeneratedTextures` interface
- Remove glow generation code (lines 67-78)
- Add `leg` to the interface and generation (if not already done in Task 4)
- Verify shadow texture is compact and dark (already suitable)

**Step 2: Update minimap colors**

In `src/ui/minimap.ts`, update terrain colors to match the new earthy palette:

```typescript
if (t === 1) ctx.fillStyle = '#2a6b6b';      // Water (teal)
else if (t === 3) ctx.fillStyle = '#8c8c8c';  // Mountain (grey)
else if (t === 2) ctx.fillStyle = '#5c7a3d';  // Fertile (rich green)
else {
  const pd = state.plantGrid[idx];
  const g = Math.floor(130 + pd * 60);  // sandy to greenish
  const r = Math.floor(160 - pd * 40);
  ctx.fillStyle = `rgb(${r},${g},90)`;
}
```

Update creature dot colors:
```typescript
ctx.fillStyle = '#7a9a6a';  // Herbivores (was '#5dd880')
ctx.fillStyle = '#a06040';  // Predators (was '#e87744')
ctx.fillStyle = '#b0a050';  // Scavengers (was '#d4a840')
```

Update background: `ctx.fillStyle = '#8b7d5e';` (earthy tan instead of black)

**Step 3: Remove unused imports and variables**

In `src/render/renderer.ts`:
- Remove `BlurFilter` import if not used elsewhere
- Remove any remaining references to removed pools/containers
- Remove `ActiveParticle` and `AmbientParticle` interfaces
- Remove `ambientParticles`, `ambientSprites`, `particles` arrays
- Remove `waterFrame` field
- Remove `SEASON_COLORS` array and `lerpColor` function
- Remove `mixTintGrey` if no longer used
- Remove `getLifeVisuals` if fully replaced

Verify all removed fields are also cleaned up in `constructor()`, `init()`, `resize()`, and `destroy()`.

**Step 4: Update background color**

In `init()`, change:
```typescript
backgroundColor: 0x1a1510,  // Dark earthy brown (was 0x0a0a0f)
```

**Step 5: Update trail colors**

If trails are kept, update their colors to earthy tones:
```typescript
// Herbivore trails
.fill({ color: 0x6a8a5a, alpha: 0.12 });
// Predator trails
.fill({ color: 0x8a5040, alpha: 0.10 });
// Scavenger trails
.fill({ color: 0x9a8a40, alpha: 0.10 });
```

Update trail fade overlay color:
```typescript
.fill({ color: 0x1a1510, alpha: this.trailFadeAlpha });
```

**Step 6: Final verification and commit**

Run: `npm run dev`
Expected: Complete satellite view aesthetic. Earthy painted terrain with smooth biome blending. Vegetation overlay showing plant density. Matte creatures with leg animation and body flex. Subtle weather tints. Clean night darkening. Minimap matches new palette.

```bash
git add src/render/renderer.ts src/render/textures.ts src/ui/minimap.ts
git commit -m "feat(graphics): final cleanup, minimap palette, texture updates"
```

---

### Task 8: Performance Optimization Pass

Ensure the new terrain painting doesn't cause frame drops, especially on resize.

**Files:**
- Modify: `src/render/terrain-painter.ts` (optional: downscale painting)
- Modify: `src/render/renderer.ts` (terrain repaint throttling)

**Step 1: Downscale terrain painting**

Full-resolution pixel painting at 3200x1800 = 5.76M pixels per repaint. This is expensive. Paint at half resolution and let PixiJS scale up (the noise texture looks fine at lower res):

In `init()`:
```typescript
const terrainScale = 0.5; // Paint at half res
this.terrainCanvas = document.createElement('canvas');
this.terrainCanvas.width = Math.ceil(options.width * terrainScale);
this.terrainCanvas.height = Math.ceil(options.height * terrainScale);
```

In `renderTerrain`, use the canvas dimensions (already correct since `paintTerrain` takes width/height from the canvas).

The terrain sprite is already full-size, so PixiJS will upscale automatically.

**Step 2: Throttle terrain repaints**

The current check repaints when season changes by >0.01. With 180s season period, that's frequent. Increase threshold:

```typescript
if (
  this.terrainDirty ||
  Math.abs(state.season - this.lastTerrainSeason) > 0.05 ||
  currentEvent !== this.lastTerrainEvent
) {
```

This repaints ~20 times per season cycle instead of ~100.

**Step 3: Verify performance**

Run: `npm run dev`
Open browser DevTools Performance tab, record 10 seconds at 4x speed with ~200+ creatures.
Expected: Stable 60fps, terrain repaints don't cause frame drops.

```bash
git add src/render/terrain-painter.ts src/render/renderer.ts
git commit -m "perf(graphics): half-res terrain painting, throttle repaints"
```
