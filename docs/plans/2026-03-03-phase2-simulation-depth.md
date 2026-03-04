# Phase 2: Simulation Depth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add terrain (water/fertile zones), scavenger species with corpse system, social steering behaviors (flocking/pack hunting), and environmental events (drought/bloom/disease).

**Architecture:** Terrain is a Uint8Array grid parallel to plantGrid. Corpses are a simple array on SimState with decay timers. Scavengers follow the same Agent pattern as herbivores/predators. Social behaviors are additional steering forces in existing functions. Events are managed by a new EventManager that triggers on seeded random intervals.

**Tech Stack:** Pure TypeScript simulation additions + renderer/UI updates for new visuals.

---

### Task 1: Terrain System

Add terrain grid generation and integrate with plant growth and creature steering.

**Files:**
- Create: `src/sim/terrain.ts`
- Modify: `src/sim/types.ts` (add TerrainType enum, terrain to SimState)
- Modify: `src/sim/plants.ts` (terrain-aware growth)
- Modify: `src/sim/agents.ts` (water avoidance steering)
- Modify: `src/sim/simulation.ts` (create terrain on init/reset)
- Modify: `src/render/renderer.ts` (render terrain cells)

**Step 1: Add terrain types to types.ts**

Add to `src/sim/types.ts`:

```typescript
export const enum TerrainType {
  Land = 0,
  Water = 1,
  Fertile = 2,
}
```

Add `terrain: Uint8Array;` to `SimState` interface (after `plantGrid`).

**Step 2: Create terrain.ts with noise-based generation**

Create `src/sim/terrain.ts`:

```typescript
import { SeededRNG } from './rng';
import type { SimConfig } from './types';
import { TerrainType } from './types';

// Simple value noise for organic terrain shapes
function valueNoise(x: number, y: number, rng: SeededRNG, seed: number): number {
  // Hash-based noise using the seed for determinism
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Smoothstep
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  // Corner values from hash
  const n00 = hashNoise(ix, iy, seed);
  const n10 = hashNoise(ix + 1, iy, seed);
  const n01 = hashNoise(ix, iy + 1, seed);
  const n11 = hashNoise(ix + 1, iy + 1, seed);

  // Bilinear interpolation
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

export function generateTerrain(config: SimConfig, rng: SeededRNG): Uint8Array {
  const cols = config.plantGridCols;
  const rows = config.plantGridRows;
  const terrain = new Uint8Array(cols * rows);
  const seed = Math.floor(rng.next() * 999999);

  // Multi-octave noise for water
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = x / cols;
      const ny = y / rows;

      // Two octaves of noise at different scales
      const n1 = valueNoise(nx * 5, ny * 5, rng, seed);
      const n2 = valueNoise(nx * 10, ny * 10, rng, seed + 1) * 0.5;
      const val = n1 + n2;

      const idx = y * cols + x;

      if (val < 0.35) {
        terrain[idx] = TerrainType.Water;
      } else if (val < 0.5) {
        terrain[idx] = TerrainType.Fertile; // Near water edges
      } else {
        terrain[idx] = TerrainType.Land;
      }
    }
  }

  return terrain;
}

export function isWater(terrain: Uint8Array, cx: number, cy: number, cols: number, rows: number): boolean {
  const wx = ((cx % cols) + cols) % cols;
  const wy = ((cy % rows) + rows) % rows;
  return terrain[wy * cols + wx] === TerrainType.Water;
}

export function getTerrainAt(terrain: Uint8Array, worldX: number, worldY: number, config: SimConfig): TerrainType {
  const cellW = config.worldWidth / config.plantGridCols;
  const cellH = config.worldHeight / config.plantGridRows;
  let cx = Math.floor(worldX / cellW) % config.plantGridCols;
  let cy = Math.floor(worldY / cellH) % config.plantGridRows;
  if (cx < 0) cx += config.plantGridCols;
  if (cy < 0) cy += config.plantGridRows;
  return terrain[cy * config.plantGridCols + cx];
}
```

**Step 3: Update plants.ts for terrain-aware growth**

In `updatePlants`, accept terrain as a parameter. If cell is Water, set density to 0. If Fertile, multiply growth rate by 2.

**Step 4: Update agents.ts with water avoidance**

Add a water repulsion force to both herbivore and predator steering. Check terrain at positions ahead and to sides; if water is nearby, steer away. Strength ~150 (strong).

**Step 5: Update simulation.ts**

- Import `generateTerrain`
- Add `terrain: generateTerrain(config, this.rng)` to state initialization in constructor and reset
- Pass `state.terrain` to `updatePlants`

**Step 6: Update renderer.ts**

Render terrain cells beneath plants:
- Water cells: acquire a plant sprite with tint `0x1a2a4a`, alpha 0.3
- Fertile cells: acquire a plant sprite with tint `0x1a3a1a`, alpha 0.15
- Render terrain layer BEFORE plant layer

**Step 7: Verify and commit**

Run `npx tsc --noEmit`, then commit.

---

### Task 2: Corpse System

Add corpses that persist after creature death.

**Files:**
- Modify: `src/sim/types.ts` (add Corpse interface, corpses to SimState)
- Modify: `src/sim/simulation.ts` (create corpses on death, decay them)
- Modify: `src/render/renderer.ts` (render corpses as fading dots)

**Step 1: Add Corpse type**

In `src/sim/types.ts`:

```typescript
export interface Corpse {
  x: number;
  y: number;
  energy: number;      // remaining energy for scavengers to eat
  creatureType: 'herbivore' | 'predator';
  decayTimer: number;  // seconds until fully decayed
  maxDecay: number;
}
```

Add `corpses: Corpse[];` to `SimState`.

**Step 2: Create corpses on death**

In `simulation.ts` step(), after filtering dead creatures but before adding newborns, iterate the pre-filter arrays. For each creature that just died (was alive before, now filtered out), create a corpse:

```typescript
{ x: pos.x, y: pos.y, energy: 20, creatureType, decayTimer: 15, maxDecay: 15 }
```

Decay corpses each step: `corpse.decayTimer -= dt`. Remove when <= 0.

**Step 3: Render corpses**

In renderer, after plants and before creatures: for each corpse, acquire a plant sprite (small dot), tint by creature type (dim version), alpha = `decayTimer / maxDecay * 0.5`.

**Step 4: Verify and commit**

---

### Task 3: Scavenger Species

Add a third creature type that eats corpses.

**Files:**
- Modify: `src/sim/types.ts` (add ScavengerTraits, Scavenger interface, config fields)
- Modify: `src/sim/agents.ts` (add scavenger creation, steering, update)
- Modify: `src/sim/simulation.ts` (scavenger spatial hash, update, spawn)
- Modify: `src/render/textures.ts` (add scavenger texture - small triangle)
- Modify: `src/render/renderer.ts` (render scavengers, add pool)
- Modify: `src/ui/overlay.ts` (show scavenger stats)

**Step 1: Types**

Add `ScavengerTraits` (speed, visionRange, metabolism, size), `Scavenger` interface extending Agent. Add config fields: `initialScavengers: 5`, reproduction thresholds, max age.

Add scavenger stats to `SimStats` (count, avg speed, avg size).

**Step 2: Scavenger steering in agents.ts**

- Attraction to nearest corpse (scaled by hunger)
- Water avoidance (same as others)
- Separation from other scavengers
- Wander noise
- When near a corpse, eat it (reduce corpse.energy, gain energy)

**Step 3: Update simulation.ts**

- Create scavenger spatial hash
- Spawn initial scavengers
- Update scavengers each step (pass corpses array)
- Scavenger reproduction, death, extinction recovery
- Events for scavenger birth/death

**Step 4: Texture + renderer**

- Generate scavenger texture: small upward triangle, white, tinted amber/yellow `0xccaa44` at render time
- Add scavenger container + pool to renderer
- Render with rotation, size-based scaling, vision-based alpha, breathing animation

**Step 5: Update UI overlay**

Add scavenger count + avg traits to stats display.

**Step 6: Verify and commit**

---

### Task 4: Social Steering Behaviors

Add flocking for herbivores and pack coordination for predators.

**Files:**
- Modify: `src/sim/agents.ts` (add alignment/cohesion to herbivore steering, pack bonus to predator steering)

**Step 1: Herbivore flocking**

In `steerHerbivore`, after the existing separation force, add:

**Alignment** (match neighbors' velocity):
- Query herbivores within 40px
- Average their velocities
- Steer toward that average velocity
- Strength: 8 (mild)

**Cohesion** (steer toward group center):
- Same neighbor query
- Compute center of mass
- Steer toward it
- Strength: 5 (mild)

**Step 2: Predator pack hunting**

In `steerPredator`, when computing attraction to prey:
- Count other predators within 60px
- If packSize >= 2, multiply prey attraction strength by `1 + 0.25 * min(packSize, 4)`
- This makes grouped predators hunt more aggressively

**Step 3: Verify and commit**

---

### Task 5: Environmental Events

Add periodic environmental events that affect the ecosystem.

**Files:**
- Create: `src/sim/events.ts`
- Modify: `src/sim/types.ts` (add ActiveEvent, event fields to SimState/SimStats)
- Modify: `src/sim/simulation.ts` (integrate event manager)
- Modify: `src/sim/plants.ts` (event modifiers)
- Modify: `src/render/renderer.ts` (visual event indicators)
- Modify: `src/ui/overlay.ts` (show active event)

**Step 1: Event types**

In `src/sim/types.ts`:

```typescript
export interface ActiveEvent {
  type: 'drought' | 'bloom' | 'disease';
  remaining: number;  // seconds left
  duration: number;   // total duration
}
```

Add `activeEvent: ActiveEvent | null;` and `eventCooldown: number;` to SimState.
Add `activeEventName: string;` to SimStats.

**Step 2: Create events.ts**

Event manager with `checkForEvent(state, rng, dt)`:
- If no active event and cooldown <= 0, roll for event type
- Drought: duration 20s, cooldown 30-60s after
- Bloom: duration 15s, cooldown 60-120s after
- Disease: instant effect (no duration), cooldown 90-180s after
- Tick active event's remaining timer

**Step 3: Integrate into simulation**

In `step()`, call event manager. Pass event state to plant growth (drought = 0.25x, bloom = 3x multiplier). Disease: when triggered, randomly select 30% of one species and reduce their energy by 40%.

**Step 4: Visual indicators**

- During drought: plant alpha reduced further, slight brown tint on background
- During bloom: plant alpha boosted, slight bright green tint
- Disease: brief red flash on affected creatures (via events array)

**Step 5: UI update**

Show current event in stats: "Event: Drought (12s)" or "Event: none"

**Step 6: Verify and commit**

---

### Task 6: Integration and Tuning

Wire everything together, tune parameters, verify build.

**Files:**
- All files from above
- Tuning adjustments as needed

**Step 1: Type check**

Run `npx tsc --noEmit`

**Step 2: Production build**

Run `npx vite build`

**Step 3: Parameter tuning**

Verify in browser:
- Water forms organic shapes, not random noise
- Creatures avoid water
- Plants grow faster on fertile ground
- Corpses appear on death and fade
- Scavengers seek corpses
- Herbivores form loose groups
- Predators coordinate when near each other
- Events trigger periodically and are visible

Adjust any parameters that feel off.

**Step 4: Final commit**
