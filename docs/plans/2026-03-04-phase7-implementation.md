# Phase 7: "Living World" Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the ecosystem simulator into an immersive, interactive nature documentary with bloom lighting, stamina-based chases, camera zoom/pan, spatial memory, ambient particles, and sound design.

**Architecture:** 6 sub-phases (7A-7F) with 7A+7B parallel, then 7C+7D+7E building on them, and 7F last. Each task is self-contained with complete code. No tests (this is a visual/sim project without test infrastructure) — verify via `npx tsc --noEmit` and screenshots.

**Tech Stack:** TypeScript, PixiJS v8, Vite, Web Audio API

---

## Sub-Phase 7A: Visual Foundation

### Task 1: Bloom filter + additive blend modes

**Files:**
- Modify: `src/render/renderer.ts:1-8` (imports), `src/render/renderer.ts:192-234` (init method)

**Step 1: Add BlurFilter import and apply to containers**

In `src/render/renderer.ts`, add `BlurFilter` to the pixi.js import:

```typescript
import { Application, Graphics, Container, Sprite, BlurFilter } from 'pixi.js';
```

After line 231 (after `this.shadowPool` creation), add:

```typescript
    // Bloom effect on glows
    this.glowContainer.filters = [new BlurFilter({ strength: 5, quality: 2 })];
    this.glowContainer.blendMode = 'add';
    this.particleContainer.blendMode = 'add';
```

**Step 2: Verify and commit**

Run: `npx tsc --noEmit`
Expected: No errors

```bash
git add src/render/renderer.ts
git commit -m "feat: add bloom filter and additive blend modes to glow/particle containers"
```

---

### Task 2: Color palette boost

**Files:**
- Modify: `src/render/renderer.ts:25-30` (SEASON_COLORS), `src/render/renderer.ts:476` (herbivore tint), `src/render/renderer.ts:532` (predator tint), `src/render/renderer.ts:589` (scavenger tint)

**Step 1: Update seasonal background colors**

In `src/render/renderer.ts`, replace the `SEASON_COLORS` array:

```typescript
const SEASON_COLORS = [
  { r: 0x18, g: 0x33, b: 0x18 }, // Spring: lush green
  { r: 0x33, g: 0x2d, b: 0x12 }, // Summer: warm amber
  { r: 0x33, g: 0x1a, b: 0x10 }, // Autumn: deep rust
  { r: 0x10, g: 0x18, b: 0x36 }, // Winter: deep blue
];
```

**Step 2: Update creature base tints**

Find the herbivore tint line `hueShiftByLineage(0x6dbb7a` and change to `hueShiftByLineage(0x5dd880`.

Find the predator tint line `hueShiftByLineage(0xcc8855` and change to `hueShiftByLineage(0xe87744`.

Find the scavenger tint line `hueShiftByLineage(0xb89955` and change to `hueShiftByLineage(0xd4a840`.

**Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/render/renderer.ts
git commit -m "feat: boost color palette — wider seasons, more saturated creatures"
```

---

### Task 3: Dawn/dusk enhancement

**Files:**
- Modify: `src/render/renderer.ts:289-297` (dawn/dusk tint section)

**Step 1: Replace the dawn/dusk tint block**

Replace the current dawn/dusk section (lines 289-297) with:

```typescript
    // Dawn/dusk warm tint — enhanced golden hour
    const isDawn = state.dayPhase < 0.2;
    const isDusk = state.dayPhase > 0.55 && state.dayPhase < 0.75;
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
```

**Step 2: Update shadow offsets to scale with sun angle**

In the herbivore, predator, and scavenger sections, find all shadow offset lines like:
```typescript
shadowH.x = sprite.x + 2;
shadowH.y = sprite.y + 2;
```

Before the creature rendering sections (after `const nightGlowBoost` line), add:

```typescript
    // Shadow offset scales with sun angle (dawn/dusk = longer shadows)
    const sunProgress = isDawn || isDusk
      ? (isDawn ? (1 - state.dayPhase / 0.2) : ((state.dayPhase - 0.55) / 0.2))
      : 0;
    const shadowOffset = 2 + sunProgress * 3;
```

Then replace all `sprite.x + 2` / `sprite.y + 2` shadow offsets with `sprite.x + shadowOffset` / `sprite.y + shadowOffset`.

**Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/render/renderer.ts
git commit -m "feat: enhanced golden hour with horizon gradient and dynamic shadows"
```

---

### Task 4: RenderTexture terrain cache

**Files:**
- Modify: `src/render/renderer.ts` — major restructure of terrain rendering

**Step 1: Add terrain cache fields to the Renderer class**

Add imports: `RenderTexture` from pixi.js.

Add class fields after the existing pool declarations:

```typescript
  private terrainTexture: RenderTexture | null = null;
  private terrainSprite: Sprite | null = null;
  private terrainGraphics: Graphics = new Graphics();
  private terrainDirty: boolean = true;
  private lastTerrainSeason: number = -1;
  private lastTerrainEvent: string = '';
  private waterOverlay: Graphics = new Graphics();
  private waterFrame: number = 0;
```

**Step 2: In init(), create terrain RenderTexture and reorganize layers**

After generating textures, create the terrain cache:

```typescript
    this.terrainTexture = RenderTexture.create({
      width: options.width,
      height: options.height,
      resolution: 1,
    });
    this.terrainSprite = new Sprite(this.terrainTexture);
```

Replace `this.app.stage.addChild(this.backgroundLayer)` with:

```typescript
    this.app.stage.addChild(this.backgroundLayer);   // season bg + dawn/dusk
    this.app.stage.addChild(this.terrainSprite!);     // cached terrain
    this.app.stage.addChild(this.waterOverlay);       // animated water shimmer
```

Keep the rest of the addChild calls in order.

**Step 3: Extract terrain drawing into a private method**

Move the entire terrain loop (section 4) into:

```typescript
  private renderTerrain(state: SimState): void {
    this.terrainGraphics.clear();
    const config = state.config;
    const cols = config.plantGridCols;
    const rows = config.plantGridRows;
    const cellW = this.worldW / cols;
    const cellH = this.worldH / rows;
    const terrainR = Math.min(cellW, cellH) * 0.5;
    const terrainPad = 2;

    // [existing terrain cell loop with arcTo corners, colors, shore fills]
    // Copy the entire existing terrain loop here

    // Render into cached texture
    this.app.renderer.render({
      container: this.terrainGraphics,
      target: this.terrainTexture!,
      clear: true,
    });
    this.terrainDirty = false;
  }
```

**Step 4: In render(), conditionally rebuild terrain cache**

Replace the inline terrain loop with:

```typescript
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
```

**Step 5: Create renderWaterOverlay method**

```typescript
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
        if (state.terrain[idx] !== 1) continue; // Only water

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
```

**Step 6: Update resize() to recreate terrain texture**

In the `resize` method, add:

```typescript
    if (this.terrainTexture) {
      this.terrainTexture.resize(width, height);
      this.terrainDirty = true;
    }
```

**Step 7: Verify and commit**

Run: `npx tsc --noEmit`
Take screenshot: `node debug/screenshot.mjs 15000 phase7a-terrain-cache.png`

```bash
git add src/render/renderer.ts
git commit -m "feat: RenderTexture terrain cache with animated water overlay"
```

---

## Sub-Phase 7B: Simulation Depth

### Task 5: Data model changes for 7B

**Files:**
- Modify: `src/sim/types.ts`

**Step 1: Add stamina fields to Agent**

In the `Agent` interface, add after `behavior: string`:

```typescript
  stamina: number;
  exhausted: boolean;
  lastThreatPos: Vec2 | null;
  threatTimer: number;
  offspringCount: number;
  deathCause: 'starved' | 'killed' | 'old_age' | 'disease' | null;
```

**Step 2: Add turnRate to PredatorTraits and ScavengerTraits**

```typescript
export interface PredatorTraits {
  speed: number;
  visionRange: number;
  attackCooldown: number;
  metabolism: number;
  size: number;
  turnRate: number;
}

export interface ScavengerTraits {
  speed: number;
  visionRange: number;
  metabolism: number;
  size: number;
  turnRate: number;
}
```

**Step 3: Verify**

Run: `npx tsc --noEmit` — expect errors in agents.ts (missing fields in creation). That's expected — we'll fix in next task.

```bash
git add src/sim/types.ts
git commit -m "feat: add stamina, threat memory, turnRate to data model"
```

---

### Task 6: Update creature creation + mutation for new fields

**Files:**
- Modify: `src/sim/agents.ts` — creation functions and mutation functions

**Step 1: Update createHerbivore**

Add the new Agent fields to the return object:

```typescript
    stamina: 100,
    exhausted: false,
    lastThreatPos: null,
    threatTimer: 0,
    offspringCount: 0,
    deathCause: null,
```

**Step 2: Update createPredator**

Same new fields, plus add `turnRate` to default traits:

```typescript
    // In default traits:
    turnRate: rng.range(2, 5),
```

And in the return object, add the same Agent fields as herbivore.

**Step 3: Update createScavenger**

Same new fields, plus add `turnRate` to default traits:

```typescript
    // In default traits:
    turnRate: rng.range(2, 5),
```

**Step 4: Update mutation functions**

In `mutatePredatorTraits`, add:
```typescript
    turnRate: mutateVal(parent.turnRate, rng, config, 1, 8),
```

In `mutateScavengerTraits`, add:
```typescript
    turnRate: mutateVal(parent.turnRate, rng, config, 1, 8),
```

**Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

```bash
git add src/sim/agents.ts
git commit -m "feat: update creature creation with stamina, turnRate, threat fields"
```

---

### Task 7: Stamina/sprint system

**Files:**
- Modify: `src/sim/agents.ts` — all three update functions

**Step 1: Add stamina helper**

After the `getSpeedMultiplier` function, add:

```typescript
function updateStamina(creature: { stamina: number; exhausted: boolean; vel: Vec2 }, maxSpeed: number, dt: number): number {
  const spd = Math.sqrt(creature.vel.x * creature.vel.x + creature.vel.y * creature.vel.y);
  const relSpeed = spd / (maxSpeed || 1);

  if (relSpeed > 0.8) {
    creature.stamina = Math.max(0, creature.stamina - 15 * dt);
  } else if (relSpeed < 0.4) {
    creature.stamina = Math.min(100, creature.stamina + 8 * dt);
  }

  if (creature.stamina <= 0) creature.exhausted = true;
  if (creature.exhausted && creature.stamina >= 30) creature.exhausted = false;

  // Return effective max speed
  return creature.exhausted ? maxSpeed * 0.6 : maxSpeed;
}
```

**Step 2: Apply in updateHerbivores**

After the steering call, before the speed clamp, replace the `const maxSpd = h.traits.speed;` line:

```typescript
    const maxSpd = updateStamina(h, h.traits.speed, dt);
```

**Step 3: Apply in updatePredators**

Same pattern — replace `const maxSpd = p.traits.speed;`:

```typescript
    const maxSpd = updateStamina(p, p.traits.speed, dt);
```

**Step 4: Apply in updateScavengers (find the equivalent section)**

Same pattern for scavengers.

**Step 5: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/agents.ts
git commit -m "feat: stamina/sprint system — exhaustion creates dramatic chases"
```

---

### Task 8: Quadratic speed-energy cost

**Files:**
- Modify: `src/sim/agents.ts` — energy cost calculations in all update functions

**Step 1: Replace herbivore energy cost**

Replace the linear speedCost line in `updateHerbivores`:

```typescript
    // Quadratic speed cost — fast creatures pay super-linearly
    const spd = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
    const relSpeed = spd / (h.traits.speed || 1);
    const speedCost = h.traits.speed * relSpeed * relSpeed * 0.008;
    const sizeCost = h.traits.size * 0.15;
    const baseMeta = h.traits.metabolism + h.traits.speed * Math.sqrt(h.traits.speed) * 0.001;
    h.energy -= (baseMeta + speedCost + sizeCost) * dt;
```

**Step 2: Replace predator energy cost**

Same pattern in `updatePredators`:

```typescript
    const spdP = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
    const relSpeedP = spdP / (p.traits.speed || 1);
    const speedCost = p.traits.speed * relSpeedP * relSpeedP * 0.008;
    const sizeCost = p.traits.size * 0.12;
    const baseMeta = p.traits.metabolism + p.traits.speed * Math.sqrt(p.traits.speed) * 0.001;
    p.energy -= (baseMeta + speedCost + sizeCost) * dt;
```

**Step 3: Same for scavengers**

**Step 4: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/agents.ts
git commit -m "feat: quadratic speed-energy cost prevents runaway speed evolution"
```

---

### Task 9: Predator target scoring + attack probability

**Files:**
- Modify: `src/sim/agents.ts` — `steerPredator` and `updatePredators`

**Step 1: Replace nearest-only target selection in steerPredator**

Replace the current closest-distance loop in steerPredator (the `herbBuf` iteration) with:

```typescript
  let bestScore = -Infinity;
  let bestDelta: Vec2 | null = null;
  let bestDist = 0;
  for (let i = 0; i < herbBuf.length; i++) {
    const h = herbBuf[i];
    const delta = herbHash.wrappedDelta(p.pos, h.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    const d = Math.sqrt(d2);
    if (d < 1) continue;
    // Score: prefer slow, small prey that's close
    const speedAdvantage = (p.traits.speed - h.traits.speed * 0.8);
    const sizeAdvantage = p.traits.size - h.traits.size;
    const catchScore = (speedAdvantage + sizeAdvantage * 0.5) / (d + 10);
    if (catchScore > bestScore) {
      bestScore = catchScore;
      bestDelta = { x: delta.x, y: delta.y };
      bestDist = d;
    }
  }
  if (bestDelta) {
    const d = bestDist;
    if (d > 1) {
```

And update the references from `closestDelta`/`closestDist` to `bestDelta`/`bestDist`.

**Step 2: Add attack probability to updatePredators**

In the hunt section, replace the instant kill:

```typescript
        if (d2 < attackRange * attackRange) {
          // Attack probability based on size/speed mismatch
          const speedAdv = (p.traits.speed - h.traits.speed) / (p.traits.speed || 1);
          const sizeAdv = (p.traits.size - h.traits.size) / (p.traits.size || 1);
          const killChance = Math.max(0.1, Math.min(0.95, 0.5 + speedAdv * 0.3 + sizeAdv * 0.2));

          if (rng.next() < killChance) {
            h.alive = false;
            h.deathCause = 'killed';
            events.push({ type: 'death', creatureType: 'herbivore', x: h.pos.x, y: h.pos.y });
            p.energy += config.predatorAttackEnergy;
          } else {
            // Failed attack — still costs energy
            p.energy -= config.predatorAttackEnergy * 0.3;
          }
          p.attackTimer = p.traits.attackCooldown;
          break;
        }
```

**Step 3: Use predator turnRate trait**

Replace the hardcoded `const turnRate = 3.5;` with:

```typescript
    const turnRate = p.traits.turnRate;
```

**Step 4: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/agents.ts
git commit -m "feat: smart predator targeting + attack probability + evolvable turnRate"
```

---

### Task 10: Threat persistence + alarm propagation

**Files:**
- Modify: `src/sim/agents.ts` — `steerHerbivore` and `updateHerbivores`

**Step 1: Update steerHerbivore for threat memory**

After the existing predator detection code (flee logic), add threat memory update:

```typescript
  // Update threat memory
  if (fleeing && predBuf.length > 0) {
    // Store the nearest predator's position
    h.lastThreatPos = { x: predBuf[0].pos.x, y: predBuf[0].pos.y };
    h.threatTimer = 5;
  }

  // Continue fleeing from remembered threat
  if (!fleeing && h.threatTimer > 0 && h.lastThreatPos) {
    const dx = h.pos.x - h.lastThreatPos.x;
    const dy = h.pos.y - h.lastThreatPos.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    fx += (dx / d) * 60;
    fy += (dy / d) * 60;
    h.behavior = 'fleeing';
  }
```

**Step 2: Decay threat timer in updateHerbivores**

After aging, add:

```typescript
    h.threatTimer = Math.max(0, h.threatTimer - dt);
```

**Step 3: Add alarm propagation**

After the steerHerbivore call in updateHerbivores, add alarm chain:

```typescript
    // Alarm propagation: fleeing herbivores alert nearby herd members
    if (h.behavior === 'fleeing' && h.lastThreatPos) {
      const nearbyHerbs: Herbivore[] = [];
      herbHash.query(h.pos, 50, nearbyHerbs);
      for (const other of nearbyHerbs) {
        if (other.id === h.id) continue;
        if (other.threatTimer <= 0) {
          other.lastThreatPos = { x: h.lastThreatPos.x, y: h.lastThreatPos.y };
          other.threatTimer = 3; // Shorter timer for chain alarms
        }
      }
    }
```

**Step 4: Set death causes for herbivore deaths**

In the death check `if (h.energy <= 0 || h.age > h.maxAge)`:

```typescript
    if (h.energy <= 0 || h.age > h.maxAge) {
      h.alive = false;
      h.deathCause = h.energy <= 0 ? 'starved' : 'old_age';
      events.push({ type: 'death', creatureType: 'herbivore', x: h.pos.x, y: h.pos.y });
```

Do the same for predator and scavenger death checks.

**Step 5: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/agents.ts
git commit -m "feat: threat persistence + alarm propagation creates herd stampedes"
```

---

### Task 11: Balance fixes

**Files:**
- Modify: `src/sim/simulation.ts` — corpse energy
- Modify: `src/sim/plants.ts` — fertile growth bonus

**Step 1: Scale corpse energy with creature size**

In `simulation.ts`, replace the fixed corpse energy values in all three corpse creation blocks.

For herbivores:
```typescript
        state.corpses.push({
          x: h.pos.x,
          y: h.pos.y,
          energy: Math.max(10, h.traits.size * Math.max(h.energy, 5) * 0.15),
          creatureType: 'herbivore',
          decayTimer: 15,
          maxDecay: 15,
        });
```

Same pattern for predators (`p.traits.size`) and scavengers (`s.traits.size`).

**Step 2: Reduce fertile growth bonus**

In `src/sim/plants.ts`, replace:
```typescript
    const effectiveR = terrain[i] === TerrainType.Fertile ? r * 2 : r;
```
with:
```typescript
    const effectiveR = terrain[i] === TerrainType.Fertile ? r * 1.4 : r;
```

And change the carrying capacity for fertile cells:
```typescript
    const effectiveK = terrain[i] === TerrainType.Fertile ? K * 1.5 : K;
    const growth = effectiveR * p * (1 - p / effectiveK) * dt;
    grid[i] = Math.max(0, Math.min(effectiveK, p + growth));
```

**Step 3: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/simulation.ts src/sim/plants.ts
git commit -m "feat: balance fixes — scaled corpse energy, reduced fertile bonus"
```

---

### Task 12: 7A+7B build verification

**Step 1: Type check**

Run: `npx tsc --noEmit`

**Step 2: Screenshot at multiple timepoints**

```bash
node debug/screenshot.mjs 10000 phase7ab-10s.png
node debug/screenshot.mjs 30000 phase7ab-30s.png
node debug/screenshot.mjs 60000 phase7ab-60s.png
```

Verify: bloom visible on creature glows, brighter colors, terrain cached properly, creatures surviving with new energy model.

---

## Sub-Phase 7C: Camera + Interaction

### Task 13: Camera module

**Files:**
- Create: `src/camera.ts`

**Step 1: Create the Camera class**

```typescript
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
    const lerp = 0.08;
    this.state.x += (this.state.targetX - this.state.x) * lerp;
    this.state.y += (this.state.targetY - this.state.y) * lerp;
    this.state.zoom += (this.state.targetZoom - this.state.zoom) * lerp;
  }

  zoomAt(screenX: number, screenY: number, screenW: number, screenH: number, delta: number): void {
    // Convert screen point to world before zoom
    const worldX = this.screenToWorldX(screenX, screenW);
    const worldY = this.screenToWorldY(screenY, screenH);

    // Apply zoom
    const factor = delta > 0 ? 0.9 : 1.1;
    this.state.targetZoom = Math.max(0.5, Math.min(4, this.state.targetZoom * factor));

    // Adjust target to keep cursor position stable
    this.state.targetX = worldX;
    this.state.targetY = worldY;
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
```

**Step 2: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/camera.ts
git commit -m "feat: camera module with zoom, pan, follow, screen-to-world transform"
```

---

### Task 14: Integrate camera into main.ts + renderer

**Files:**
- Modify: `src/main.ts`
- Modify: `src/render/renderer.ts`

**Step 1: Add camera to main.ts**

Import and create camera:
```typescript
import { Camera } from './camera';
```

Add field: `private camera: Camera;`

In constructor: `this.camera = new Camera(1600, 900);`

In `start()`, after world size is set: `this.camera.resize(width, height);`

**Step 2: Add camera input handlers**

After the click handler in `start()`:

```typescript
    // Camera: mouse wheel zoom
    this.renderer.app.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, e.deltaY);
    }, { passive: false });

    // Camera: middle/right-click drag to pan
    let panning = false;
    let lastPanX = 0, lastPanY = 0;
    this.renderer.app.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) {
        panning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        e.preventDefault();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (panning) {
        this.camera.panBy(e.clientX - lastPanX, e.clientY - lastPanY);
        lastPanX = e.clientX;
        lastPanY = e.clientY;
      }
    });
    window.addEventListener('mouseup', () => { panning = false; });
    this.renderer.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Camera: double-click to zoom in
    this.renderer.app.canvas.addEventListener('dblclick', (e) => {
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
      const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);
      this.camera.centerOn(worldX, worldY, 2);
    });
```

**Step 3: Add keyboard shortcuts for camera**

In the existing keyboard handler (overlay.ts or main.ts), add:
- `0` key: `this.camera.resetView()`
- `C` key: toggle follow on first pinned creature

**Step 4: Update click handler to transform through camera**

Replace the click coordinate transform:

```typescript
    this.renderer.app.canvas.addEventListener('click', (e) => {
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
      const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);
      this.inspector.tryPin(this.sim.state, worldX, worldY);
    });
```

**Step 5: Update the render loop**

```typescript
    // Update camera
    this.camera.update();

    // If following a creature, track it
    if (this.camera.state.following !== null) {
      const all = [...this.sim.state.herbivores, ...this.sim.state.predators, ...this.sim.state.scavengers];
      const target = all.find(c => c.id === this.camera.state.following);
      if (target) {
        this.camera.centerOn(target.pos.x, target.pos.y);
      } else {
        this.camera.follow(null);
        this.camera.resetView();
      }
    }

    // Pass camera to renderer
    this.renderer.render(this.sim.state, this.sim.state.time, this.inspector.pinnedIds, this.camera.state);
```

**Step 6: Update renderer to apply camera transform**

Change render method signature:

```typescript
  render(state: SimState, time: number, selectedIds?: number[], camera?: CameraState): void {
```

At the start of render, apply camera:

```typescript
    if (camera) {
      this.app.stage.scale.set(camera.zoom);
      this.app.stage.position.set(
        this.worldW / 2 - camera.x * camera.zoom,
        this.worldH / 2 - camera.y * camera.zoom
      );
    }
```

Import `CameraState` from camera.ts.

**Step 7: Update resize handler**

```typescript
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.resize(w, h);
      this.camera.resize(w, h);
      // ...
    });
```

**Step 8: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/main.ts src/render/renderer.ts src/camera.ts
git commit -m "feat: camera zoom/pan/follow integrated into app"
```

---

### Task 15: Hover tooltips

**Files:**
- Create: `src/ui/tooltip.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`

**Step 1: Create tooltip module**

```typescript
export class Tooltip {
  private el: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'tooltip';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  show(x: number, y: number, html: string): void {
    this.el.innerHTML = html;
    this.el.style.display = 'block';
    // Position near cursor, flip if near edge
    const pad = 12;
    const maxX = window.innerWidth - 180;
    const maxY = window.innerHeight - 80;
    this.el.style.left = `${Math.min(x + pad, maxX)}px`;
    this.el.style.top = `${Math.min(y + pad, maxY)}px`;
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
```

**Step 2: Add CSS**

```css
#tooltip {
  position: fixed;
  background: rgba(10, 12, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 11px;
  color: #ccc;
  pointer-events: none;
  z-index: 200;
  transition: transform 0.05s;
  max-width: 160px;
}
#tooltip .tt-type { color: #8cf; font-weight: bold; }
#tooltip .tt-behavior { color: #aaa; font-style: italic; }
```

**Step 3: Wire into main.ts**

Add mousemove handler that queries nearest creature and shows tooltip:

```typescript
    this.renderer.app.canvas.addEventListener('mousemove', (e) => {
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
      const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);

      // Find nearest creature within 20 world-px
      let bestDist = 20 * 20;
      let best: any = null;
      for (const c of [...state.herbivores, ...state.predators, ...state.scavengers]) {
        const dx = c.pos.x - worldX, dy = c.pos.y - worldY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { bestDist = d2; best = c; }
      }
      if (best) {
        const label = best.type.charAt(0).toUpperCase() + best.type.slice(1);
        this.tooltip.show(e.clientX, e.clientY,
          `<span class="tt-type">${label} #${best.id}</span><br>` +
          `Energy: ${best.energy.toFixed(0)} | Gen ${best.generation}<br>` +
          `<span class="tt-behavior">${best.behavior}</span>`
        );
        this.renderer.app.canvas.style.cursor = 'pointer';
      } else {
        this.tooltip.hide();
        this.renderer.app.canvas.style.cursor = 'default';
      }
    });

    this.renderer.app.canvas.addEventListener('mouseleave', () => {
      this.tooltip.hide();
    });
```

**Step 4: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/ui/tooltip.ts src/main.ts src/styles.css
git commit -m "feat: hover tooltips show creature info on mousemove"
```

---

### Task 16: Minimap

**Files:**
- Create: `src/ui/minimap.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`

**Step 1: Create minimap module**

```typescript
import type { SimState } from '../sim/types';
import type { CameraState } from '../camera';
import { TerrainType } from '../sim/types';

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
    // Only show when zoomed in
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
        const t = state.terrain[y * cols + x];
        if (t === TerrainType.Water) ctx.fillStyle = '#0f2844';
        else if (t === TerrainType.Mountain) ctx.fillStyle = '#2a2520';
        else if (t === TerrainType.Fertile) ctx.fillStyle = '#0a1a08';
        else {
          const pd = state.plantGrid[y * cols + x];
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
```

**Step 2: Add CSS**

```css
#minimap {
  position: fixed;
  bottom: 80px;
  left: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  overflow: hidden;
  z-index: 50;
}
#minimap canvas { display: block; }
```

**Step 3: Wire into main.ts**

Create minimap, update in loop, click-to-pan.

**Step 4: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/ui/minimap.ts src/main.ts src/styles.css
git commit -m "feat: minimap with creature dots and viewport indicator"
```

---

## Sub-Phase 7D: Ecological Memory

### Task 17: Spatial memory system

**Files:**
- Modify: `src/sim/types.ts` — add SpatialMemory interface
- Modify: `src/sim/agents.ts` — memory update + steering integration

**Step 1: Add SpatialMemory to types.ts**

```typescript
export interface SpatialMemory {
  foodQuality: Float32Array;   // 64 cells (8x8)
  dangerLevel: Float32Array;
  lastVisited: Float32Array;
}
```

**Step 2: Create memory helper functions in agents.ts**

```typescript
function createMemory(): SpatialMemory {
  return {
    foodQuality: new Float32Array(64),
    dangerLevel: new Float32Array(64),
    lastVisited: new Float32Array(64),
  };
}

function getMemoryCell(x: number, y: number, config: SimConfig): number {
  const col = Math.floor((x / config.worldWidth) * 8);
  const row = Math.floor((y / config.worldHeight) * 8);
  return Math.max(0, Math.min(63, row * 8 + Math.max(0, Math.min(7, col))));
}

function updateMemory(mem: SpatialMemory, creature: Agent, state: SimState, plantDensity: number, threatNearby: boolean): void {
  const cell = getMemoryCell(creature.pos.x, creature.pos.y, state.config);
  const decay = 0.97; // memory fades ~3% per tick

  // Decay all cells
  for (let i = 0; i < 64; i++) {
    mem.foodQuality[i] *= decay;
    mem.dangerLevel[i] *= decay;
  }

  // Update current cell
  mem.foodQuality[cell] = mem.foodQuality[cell] * 0.8 + plantDensity * 0.2;
  if (threatNearby) mem.dangerLevel[cell] = Math.min(1, mem.dangerLevel[cell] + 0.3);
  mem.lastVisited[cell] = state.time;
}

function getMemorySteer(mem: SpatialMemory, creature: Agent, config: SimConfig, time: number): Vec2 {
  let fx = 0, fy = 0;
  const cx = creature.pos.x;
  const cy = creature.pos.y;
  const cellW = config.worldWidth / 8;
  const cellH = config.worldHeight / 8;

  for (let i = 0; i < 64; i++) {
    const col = i % 8;
    const row = Math.floor(i / 8);
    const targetX = (col + 0.5) * cellW;
    const targetY = (row + 0.5) * cellH;
    const dx = targetX - cx;
    const dy = targetY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    const staleness = Math.min(1, (time - mem.lastVisited[i]) / 30);
    const foodAttraction = mem.foodQuality[i] * (1 - staleness * 0.5);
    const dangerRepulsion = mem.dangerLevel[i];

    const strength = (foodAttraction * 15 - dangerRepulsion * 25) / (dist * 0.1 + 1);
    fx += (dx / dist) * strength;
    fy += (dy / dist) * strength;
  }

  return { x: fx, y: fy };
}
```

**Step 3: Initialize memory in creature creation functions**

Add `memory: createMemory()` to the return objects (or `memory: null` initially and allocate lazily).

**Step 4: Integrate into steerHerbivore**

After wander noise, before behavior setting:
```typescript
  // Memory-based navigation
  if (h.memory) {
    const memSteer = getMemorySteer(h.memory, h, state.config, state.time);
    fx += memSteer.x;
    fy += memSteer.y;
  }
```

**Step 5: Update memory in updateHerbivores**

After eating plants:
```typescript
    if (h.memory) {
      const plantCell = getMemoryCell(h.pos.x, h.pos.y, config);
      const plantDensity = state.plantGrid[plantCell] || 0;
      updateMemory(h.memory, h, state, plantDensity, h.behavior === 'fleeing');
    }
```

**Step 6: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/types.ts src/sim/agents.ts
git commit -m "feat: spatial memory system — creatures develop home ranges and avoid danger zones"
```

---

### Task 18: Overgrazing / soil degradation

**Files:**
- Modify: `src/sim/types.ts` — add soilHealth to SimState
- Modify: `src/sim/simulation.ts` — initialize soilHealth
- Modify: `src/sim/plants.ts` — factor soil health into growth

**Step 1: Add soilHealth to SimState**

```typescript
  soilHealth: Float32Array;
```

**Step 2: Initialize in simulation.ts reset()**

```typescript
    soilHealth: new Float32Array(config.plantGridCols * config.plantGridRows).fill(1.0),
```

**Step 3: Update growPlants in plants.ts**

Add soilHealth parameter, degrade when overgrazed, multiply growth:

```typescript
export function growPlants(
  grid: Float32Array,
  terrain: Uint8Array,
  soilHealth: Float32Array,
  config: SimConfig,
  dt: number,
  seasonalMul: number = 1
): void {
  const r = config.plantGrowthRate * seasonalMul;
  const K = config.plantCarryingCapacity;
  const cols = config.plantGridCols;
  const rows = config.plantGridRows;

  for (let i = 0; i < cols * rows; i++) {
    if (terrain[i] === TerrainType.Water || terrain[i] === TerrainType.Mountain) {
      grid[i] = 0;
      continue;
    }

    // Soil health affects growth
    const soil = soilHealth[i];

    // Degrade soil when overgrazed (plant density < 10% capacity)
    if (grid[i] < K * 0.1 && grid[i] < soilHealth[i] * K * 0.5) {
      soilHealth[i] = Math.max(0.1, soilHealth[i] - 0.002 * dt);
    } else {
      // Slowly recover soil (10x slower than plant growth)
      soilHealth[i] = Math.min(1, soilHealth[i] + 0.001 * dt);
    }

    const effectiveR = (terrain[i] === TerrainType.Fertile ? r * 1.4 : r) * soil;
    const effectiveK = terrain[i] === TerrainType.Fertile ? K * 1.5 : K;
    const p = grid[i];
    const growth = effectiveR * p * (1 - p / effectiveK) * dt;
    grid[i] = Math.max(0, Math.min(effectiveK, p + growth));
  }
}
```

**Step 4: Update call site in simulation.ts**

Pass `state.soilHealth` to `growPlants`.

**Step 5: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/types.ts src/sim/simulation.ts src/sim/plants.ts
git commit -m "feat: overgrazing soil degradation creates desertification cycles"
```

---

### Task 19: Contagion disease

**Files:**
- Modify: `src/sim/types.ts` — add `infected` field (already added in Task 5)
- Modify: `src/sim/events.ts` — replace instant disease with contagion seed
- Modify: `src/sim/agents.ts` — spread + damage logic in update functions

**Step 1: Modify disease event to seed infection**

In `events.ts`, change disease to infect 2-3 random creatures instead of instant damage:

```typescript
// In applyEvent disease case:
// Instead of random damage to all, infect a few seeds
const targets = species === 'herbivore' ? state.herbivores :
                species === 'predator' ? state.predators : state.scavengers;
const count = Math.min(3, targets.length);
for (let i = 0; i < count; i++) {
  const idx = Math.floor(rng.next() * targets.length);
  targets[idx].infected = 10; // 10 second infection timer
}
```

**Step 2: Add contagion spread in update functions**

In updateHerbivores, after movement:
```typescript
    // Disease spread
    if (h.infected > 0) {
      h.infected -= dt;
      h.energy -= 3 * dt; // Damage over time
      // Spread to nearby same-species
      const nearbyH: Herbivore[] = [];
      herbHash.query(h.pos, 30, nearbyH);
      for (const other of nearbyH) {
        if (other.id === h.id || other.infected > 0) continue;
        const delta = herbHash.wrappedDelta(h.pos, other.pos);
        const d = Math.sqrt(delta.x * delta.x + delta.y * delta.y) || 1;
        if (rng.next() < 0.05 / d) {
          other.infected = 8;
        }
      }
      if (h.infected <= 0) h.infected = 0;
    }
```

Same pattern for predators and scavengers.

**Step 3: Set deathCause to 'disease' when appropriate**

**Step 4: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/sim/events.ts src/sim/agents.ts
git commit -m "feat: contagion disease spreads through proximity — density-dependent epidemics"
```

---

## Sub-Phase 7E: Visual Atmosphere

### Task 20: Ambient particles

**Files:**
- Modify: `src/render/renderer.ts` — add ambient particle layer

**Step 1: Add ambient particle system**

Add a new `ambientParticles` array and generation logic. In the render method, after the creature sections:

```typescript
    // === Ambient particles ===
    // Generate near water (mist), over plants (pollen), at night (fireflies)
    if (this.ambientParticles.length < 50) {
      // Spawn new ambient particles based on environment
      // [implementation: spawn near water cells, dense plant cells, or randomly at night]
    }
    // Update and render ambient particles
    for (let i = this.ambientParticles.length - 1; i >= 0; i--) {
      const ap = this.ambientParticles[i];
      ap.x += ap.vx * dt;
      ap.y += ap.vy * dt;
      ap.life -= dt;
      if (ap.life <= 0) {
        this.ambientParticles.splice(i, 1);
        continue;
      }
      const sprite = this.particlePool.acquire();
      sprite.x = ap.x;
      sprite.y = ap.y;
      sprite.tint = ap.tint;
      sprite.alpha = ap.alpha * (ap.life / ap.maxLife);
      sprite.scale.set(ap.scale);
    }
```

Full implementation with mist/pollen/firefly logic based on terrain and time of day.

**Step 2: Verify and commit**

```bash
git add src/render/renderer.ts
git commit -m "feat: ambient particles — mist, pollen, fireflies add atmospheric life"
```

---

### Task 21: Enhanced weather visuals

**Files:**
- Modify: `src/render/renderer.ts` — weather rendering section

**Step 1: Rain depth — add background rain layer**

In the rain rendering section, after the existing foreground rain, add a second layer:

```typescript
    // Background rain layer (shorter, fainter, slightly different angle)
    for (let i = 0; i < rainCount * 0.5; i++) {
      const rx = rng.next() * this.worldW;
      const ry = rng.next() * this.worldH;
      const bgAngle = rainAngle + 0.1;
      this.weatherLayer
        .moveTo(rx, ry)
        .lineTo(rx + Math.sin(bgAngle) * 6, ry + Math.cos(bgAngle) * 6)
        .stroke({ color: 0x8899bb, width: 0.5, alpha: 0.08 * intensity });
    }
```

**Step 2: Volumetric fog — replace flat overlay with drifting blobs**

Replace fog rendering with glow-based blobs:

```typescript
    if (state.weather.type === 'fog') {
      const fogCount = Math.floor(3 + intensity * 4);
      for (let i = 0; i < fogCount; i++) {
        const fogSprite = this.glowPool.acquire();
        const seed = i * 137.5;
        fogSprite.x = ((seed + time * 5) % this.worldW);
        fogSprite.y = ((seed * 2.3 + time * 3) % this.worldH);
        fogSprite.tint = 0xccccbb;
        fogSprite.alpha = intensity * 0.12;
        fogSprite.scale.set(20 + intensity * 15);
      }
    }
```

**Step 3: Wind plant interaction**

In the plant rendering section, when wind is active, offset plant positions:

```typescript
    const windOffsetX = state.weather.type === 'wind'
      ? Math.sin(time * 1.5 + cellIndex * 0.3) * state.weather.intensity * 2
      : 0;
    // Apply to plant sprite x position
```

**Step 4: Verify and commit**

```bash
git add src/render/renderer.ts
git commit -m "feat: enhanced weather — rain depth, volumetric fog, wind-swayed plants"
```

---

## Sub-Phase 7F: Observability

### Task 22: Trait evolution sparklines

**Files:**
- Modify: `src/ui/graph.ts` — extend DataPoint, add trait lines
- Modify: `src/sim/types.ts` — ensure SimStats has trait averages

**Step 1: Extend DataPoint with trait values**

Add to the data point storage: avgHerbSpeed, avgHerbSize, avgPredSpeed, avgPredSize.

**Step 2: Add trait sparklines below population graph**

Toggle via `T` key. Render as thin colored lines on a second canvas or shared canvas.

**Step 3: Verify and commit**

```bash
git add src/ui/graph.ts src/styles.css
git commit -m "feat: trait evolution sparklines — watch natural selection in real-time"
```

---

### Task 23: Inspector upgrades

**Files:**
- Modify: `src/ui/inspector.ts`
- Modify: `src/styles.css`

**Step 1: Add energy sparkline ring buffer**

```typescript
  private energyHistory: Map<number, number[]> = new Map();
```

Each update, push current energy to the buffer (max 60 entries = 10s at 6fps update). Render as a tiny inline SVG or canvas sparkline.

**Step 2: Show death cause**

Replace the "Dead" text with the creature's `deathCause` value (Starved/Killed/Old Age/Disease).

**Step 3: Show offspring count**

Add `Offspring: ${c.offspringCount}` row.

**Step 4: Add lineage color swatch**

Add a small `<span>` with inline background-color matching the rendered creature tint.

**Step 5: Verify and commit**

```bash
git add src/ui/inspector.ts src/styles.css
git commit -m "feat: inspector upgrades — energy sparkline, death cause, offspring, lineage swatch"
```

---

### Task 24: Event feed improvements

**Files:**
- Modify: `src/ui/feed.ts`
- Modify: `src/styles.css`

**Step 1: Base fade on sim-time**

Replace `Date.now()` references with sim-time from the feed event timestamps.

**Step 2: Increase MAX_ENTRIES to 10**

**Step 3: Add severity styling**

Critical events (extinction, disease) get a colored left border and longer duration.

**Step 4: Verify and commit**

```bash
git add src/ui/feed.ts src/styles.css
git commit -m "feat: event feed — sim-time fade, severity levels, expanded capacity"
```

---

### Task 25: Sound design

**Files:**
- Create: `src/audio/audio-manager.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/overlay.ts` — add volume slider

**Step 1: Create AudioManager**

```typescript
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = false;

  init(): void {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.gain.value = 0.3;
    this.enabled = true;
  }

  setVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = v;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (this.masterGain) this.masterGain.gain.value = this.enabled ? 0.3 : 0;
  }

  // Generative ambient drone
  playAmbient(season: number, dayPhase: number): void {
    if (!this.ctx || !this.enabled) return;
    // Soft oscillator drone that shifts with season
  }

  // Rain sound
  playRain(intensity: number): void {
    if (!this.ctx || !this.enabled) return;
    // White noise filtered through bandpass, volume = intensity
  }

  // Event sting
  playEvent(type: 'birth' | 'death' | 'extinction' | 'disease'): void {
    if (!this.ctx || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.masterGain!);

    if (type === 'birth') {
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
    } else if (type === 'death') {
      osc.frequency.value = 200;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
    } else if (type === 'extinction') {
      osc.frequency.value = 150;
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.0);
    }

    osc.start();
    osc.stop(this.ctx.currentTime + 1.5);
  }
}
```

**Step 2: Wire into main.ts**

Initialize AudioManager on first user interaction (click/key). Update ambient in render loop. Trigger event stings from feed events.

**Step 3: Add volume toggle/slider to settings panel**

**Step 4: Verify and commit**

```bash
git add src/audio/audio-manager.ts src/main.ts src/ui/overlay.ts
git commit -m "feat: sound design — ambient drone, rain, event stings via Web Audio"
```

---

### Task 26: Final Phase 7 build verification

**Step 1: Full type check**

Run: `npx tsc --noEmit`

**Step 2: Production build**

Run: `npx vite build`

**Step 3: Screenshot suite**

```bash
node debug/screenshot.mjs 10000 phase7-final-10s.png
node debug/screenshot.mjs 45000 phase7-final-45s.png
node debug/screenshot.mjs 90000 phase7-final-90s.png
```

**Step 4: Verify checklist**
- [ ] Bloom visible on creature glows, especially at night
- [ ] Additive blend makes overlapping glows brighter
- [ ] Terrain only redraws when season changes
- [ ] Colors are more vibrant than before
- [ ] Dawn/dusk has visible warm gradient
- [ ] Creatures exhaust during chases
- [ ] Predators prefer catchable prey, not just nearest
- [ ] Failed attacks visible (predator loses energy, prey survives)
- [ ] Herbivore stampedes propagate through herd
- [ ] Camera zoom with mousewheel works
- [ ] Pan with middle-click drag
- [ ] Follow mode tracks pinned creature
- [ ] Minimap shows when zoomed in
- [ ] Hover tooltips appear on mousemove
- [ ] Spatial memory creates visible home ranges over time
- [ ] Overgrazing creates brown patches that recover
- [ ] Disease spreads between nearby creatures
- [ ] Ambient particles (mist near water, pollen, fireflies at night)
- [ ] Rain has depth (foreground + background layers)
- [ ] Fog is patchy blobs, not flat overlay
- [ ] Trait sparklines show evolution trends
- [ ] Inspector shows energy history, death cause, offspring count
- [ ] Event feed fades by sim-time, has severity colors
- [ ] Audio plays ambient + event stings

```bash
git add -A
git commit -m "Phase 7: Living World — complete build verification"
```
