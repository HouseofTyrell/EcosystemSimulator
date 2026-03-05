# Phase 10: Multiple Species, Mating & Tuning — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 subspecies (2 per role) with distinct traits and colors, replace asexual spawning with two-parent mating, fix predator energy balance, slow sim speed, convert graph to draggable box, and fix settings panel direction.

**Architecture:** New `subspecies.ts` defines subspecies lookup tables. Agent interface gets a `subspecies` field. Creation functions assign subspecies and clamp traits. Reproduction becomes two-parent: find nearby same-subspecies mate, blend traits, spawn at midpoint. Predator energy rebalanced by raising satiation threshold and kill energy. Sim speed halved at base. Graph restyled as box. Settings panel expansion fixed.

**Tech Stack:** TypeScript, PixiJS v8, Vite

---

### Task 1: Subspecies Definitions Module

Create the subspecies lookup tables.

**Files:**
- Create: `src/sim/subspecies.ts`

**Changes:**

Create new file with this content:

```typescript
import type { HerbivoreTraits, PredatorTraits, ScavengerTraits } from './types';

export interface SubspeciesDef {
  name: string;
  hueBase: number;
  hueRange: number;
}

export interface HerbSubspeciesDef extends SubspeciesDef {
  speedRange: [number, number];
  sizeRange: [number, number];
  visionRange: [number, number];
  turnRateRange: [number, number];
  metabolismRange: [number, number];
}

export interface PredSubspeciesDef extends SubspeciesDef {
  speedRange: [number, number];
  sizeRange: [number, number];
  visionRange: [number, number];
  turnRateRange: [number, number];
  metabolismRange: [number, number];
  attackCooldownRange: [number, number];
  killEnergyBonus: number; // multiplier on base kill energy
}

export interface ScavSubspeciesDef extends SubspeciesDef {
  speedRange: [number, number];
  sizeRange: [number, number];
  visionRange: [number, number];
  turnRateRange: [number, number];
  metabolismRange: [number, number];
  eatSpeedMultiplier: number;
  reproductionCostMultiplier: number;
}

export const HERB_SUBSPECIES: HerbSubspeciesDef[] = [
  {
    name: 'Grazer',
    hueBase: 0x44ccaa,
    hueRange: 20,
    speedRange: [35, 60],
    sizeRange: [3, 5],
    visionRange: [40, 80],
    turnRateRange: [2, 4],
    metabolismRange: [1.5, 2.5],
  },
  {
    name: 'Forager',
    hueBase: 0x88dd44,
    hueRange: 20,
    speedRange: [60, 95],
    sizeRange: [1.5, 3],
    visionRange: [70, 130],
    turnRateRange: [3, 6],
    metabolismRange: [2.5, 4],
  },
];

export const PRED_SUBSPECIES: PredSubspeciesDef[] = [
  {
    name: 'Stalker',
    hueBase: 0xee6644,
    hueRange: 20,
    speedRange: [70, 100],
    sizeRange: [2.5, 4],
    visionRange: [80, 150],
    turnRateRange: [2.5, 5],
    metabolismRange: [2, 3.5],
    attackCooldownRange: [0.8, 1.8],
    killEnergyBonus: 1.1,
  },
  {
    name: 'Pack Hunter',
    hueBase: 0xcc44aa,
    hueRange: 20,
    speedRange: [50, 80],
    sizeRange: [3, 5.5],
    visionRange: [60, 120],
    turnRateRange: [2, 4],
    metabolismRange: [2.5, 4],
    attackCooldownRange: [1.2, 2.5],
    killEnergyBonus: 1.0,
  },
];

export const SCAV_SUBSPECIES: ScavSubspeciesDef[] = [
  {
    name: 'Vulture',
    hueBase: 0xddcc55,
    hueRange: 20,
    speedRange: [50, 80],
    sizeRange: [1.5, 3],
    visionRange: [80, 140],
    turnRateRange: [3, 6],
    metabolismRange: [2, 3.5],
    eatSpeedMultiplier: 0.6,
    reproductionCostMultiplier: 1.0,
  },
  {
    name: 'Beetle',
    hueBase: 0xaa7722,
    hueRange: 20,
    speedRange: [30, 55],
    sizeRange: [2, 4],
    visionRange: [40, 80],
    turnRateRange: [2, 4],
    metabolismRange: [1.5, 2.5],
    eatSpeedMultiplier: 1.5,
    reproductionCostMultiplier: 0.7,
  },
];

/** Clamp a value to a range */
export function clampRange(val: number, range: [number, number]): number {
  return Math.max(range[0], Math.min(range[1], val));
}

/** Clamp herbivore traits to subspecies ranges */
export function clampHerbTraits(traits: HerbivoreTraits, sub: number): void {
  const def = HERB_SUBSPECIES[sub];
  traits.speed = clampRange(traits.speed, def.speedRange);
  traits.size = clampRange(traits.size, def.sizeRange);
  traits.visionRange = clampRange(traits.visionRange, def.visionRange);
  traits.turnRate = clampRange(traits.turnRate, def.turnRateRange);
  traits.metabolism = clampRange(traits.metabolism, def.metabolismRange);
}

/** Clamp predator traits to subspecies ranges */
export function clampPredTraits(traits: PredatorTraits, sub: number): void {
  const def = PRED_SUBSPECIES[sub];
  traits.speed = clampRange(traits.speed, def.speedRange);
  traits.size = clampRange(traits.size, def.sizeRange);
  traits.visionRange = clampRange(traits.visionRange, def.visionRange);
  traits.turnRate = clampRange(traits.turnRate, def.turnRateRange);
  traits.metabolism = clampRange(traits.metabolism, def.metabolismRange);
  traits.attackCooldown = clampRange(traits.attackCooldown, def.attackCooldownRange);
}

/** Clamp scavenger traits to subspecies ranges */
export function clampScavTraits(traits: ScavengerTraits, sub: number): void {
  const def = SCAV_SUBSPECIES[sub];
  traits.speed = clampRange(traits.speed, def.speedRange);
  traits.size = clampRange(traits.size, def.sizeRange);
  traits.visionRange = clampRange(traits.visionRange, def.visionRange);
  traits.turnRate = clampRange(traits.turnRate, def.turnRateRange);
  traits.metabolism = clampRange(traits.metabolism, def.metabolismRange);
}

/** Get subspecies name for any creature */
export function getSubspeciesName(type: 'herbivore' | 'predator' | 'scavenger', sub: number): string {
  if (type === 'herbivore') return HERB_SUBSPECIES[sub]?.name || 'Unknown';
  if (type === 'predator') return PRED_SUBSPECIES[sub]?.name || 'Unknown';
  return SCAV_SUBSPECIES[sub]?.name || 'Unknown';
}
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/subspecies.ts && git commit -m "feat(p10): subspecies definition module with trait clamping"`

---

### Task 2: Subspecies Field on Agent + Creation Functions

Add `subspecies` field to Agent and assign in creation functions with trait clamping.

**Files:**
- Modify: `src/sim/types.ts:59` (Agent interface)
- Modify: `src/sim/agents.ts:155-292` (create functions)

**Changes:**

1. In `src/sim/types.ts`, add to `Agent` interface after `birthPos: Vec2;` (line 59):

```typescript
  subspecies: number;
```

2. In `src/sim/agents.ts`, add import at top (after existing imports around line 21):

```typescript
import { clampHerbTraits, clampPredTraits, clampScavTraits } from './subspecies';
```

3. In `createHerbivore` (line 155), add `subspecies` parameter:

Change signature from:
```typescript
export function createHerbivore(
  id: number,
  x: number,
  y: number,
  rng: SeededRNG,
  config: SimConfig,
  parentTraits?: HerbivoreTraits
): Herbivore {
```
to:
```typescript
export function createHerbivore(
  id: number,
  x: number,
  y: number,
  rng: SeededRNG,
  config: SimConfig,
  parentTraits?: HerbivoreTraits,
  subspecies?: number
): Herbivore {
  const sub = subspecies ?? (rng.next() < 0.5 ? 0 : 1);
```

After traits are generated (after `const traits = { ... }` block), add:
```typescript
  clampHerbTraits(traits, sub);
```

In the return object, add before `birthPos`:
```typescript
    subspecies: sub,
```

4. Same pattern for `createPredator`:

Change signature to add `subspecies?: number` parameter. Add `const sub = subspecies ?? (rng.next() < 0.5 ? 0 : 1);` after signature. Add `clampPredTraits(traits, sub);` after traits generation. Add `subspecies: sub,` to return object.

5. Same for `createScavenger`:

Add `subspecies?: number` parameter. Add `const sub = subspecies ?? (rng.next() < 0.5 ? 0 : 1);`. Add `clampScavTraits(traits, sub);`. Add `subspecies: sub,` to return object.

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/agents.ts && git commit -m "feat(p10): subspecies field on Agent with trait clamping in creation"`

---

### Task 3: Predator Energy Rebalance

Fix the satiation trap and improve predator sustain.

**Files:**
- Modify: `src/sim/types.ts:253` (predatorAttackEnergy)
- Modify: `src/sim/agents.ts:985` (attack satiation condition)
- Modify: `src/sim/agents.ts:979-982` (remove starvation acceleration)
- Modify: `src/sim/agents.ts` (steerPredator satiation threshold)

**Changes:**

1. In `src/sim/types.ts`, change `predatorAttackEnergy` (line 253) from `40` to `50`:

```typescript
  predatorAttackEnergy: 50,
```

2. In `src/sim/agents.ts`, find the satiation threshold in `steerPredator` (the line with `const satiationThreshold = state.config.predatorReproductionEnergy * 0.8`). Change `0.8` to `1.2`:

```typescript
  const satiationThreshold = state.config.predatorReproductionEnergy * 1.2;
```

3. In `src/sim/agents.ts`, find the attack condition (line 985). Change `config.predatorReproductionEnergy * 0.8` to `config.predatorReproductionEnergy * 1.2`:

```typescript
    if (p.attackTimer <= 0 && p.energy <= config.predatorReproductionEnergy * 1.2) {
```

4. In `src/sim/agents.ts`, remove the starvation acceleration block (lines 979-982). Delete these lines:

```typescript
    // Starvation acceleration: metabolism +50% when energy is low
    if (p.energy < 30) {
      p.energy -= baseMetaP * 0.5 * dt;
    }
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/agents.ts && git commit -m "feat(p10): fix predator energy balance — raise satiation to 1.2x, kill energy to 50"`

---

### Task 4: Pack Hunter Kill Energy Bonus

Pack Hunters get 1.5x kill energy when 2+ predators are nearby.

**Files:**
- Modify: `src/sim/agents.ts:1004` (kill energy line)

**Changes:**

1. Find the predator kill energy line (around line 1004): `p.energy += config.predatorAttackEnergy;`

Replace with:

```typescript
            // Pack Hunter bonus: 1.5x energy when grouped
            let killEnergy = config.predatorAttackEnergy;
            if (p.subspecies === 1) {
              const nearPreds: Predator[] = [];
              predHash.query(p.pos, 80, nearPreds);
              if (nearPreds.length >= 2) killEnergy *= 1.5;
            } else {
              // Stalker bonus: 10% solo kill energy
              killEnergy *= 1.1;
            }
            p.energy += killEnergy;
```

Note: This requires `predHash` to be accessible in the `updatePredators` function. Check that it's passed as a parameter. If not, you'll need to use the existing spatial hash that's available in that scope.

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p10): subspecies kill energy bonuses — Stalker solo +10%, Pack Hunter grouped +50%"`

---

### Task 5: Two-Parent Mating System (Herbivores)

Replace asexual herbivore reproduction with two-parent mating.

**Files:**
- Modify: `src/sim/agents.ts:911-945` (herbivore reproduction block)

**Changes:**

Replace the entire herbivore reproduction block (lines 911-945) with:

```typescript
    // Reproduction: two-parent mating system
    if (
      h.energy > config.herbivoreReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      h.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.herbivores.length + newborns.length < config.maxHerbivores &&
      densityReproChance(state.herbivores.length, config.maxHerbivores, rng)
    ) {
      // Find nearby mate: same subspecies, energy > 50% threshold, cooldown ready, not baby
      const mateBuf: Herbivore[] = [];
      herbHash.query(h.pos, 60, mateBuf);
      let mate: Herbivore | null = null;
      for (let mi = 0; mi < mateBuf.length; mi++) {
        const m = mateBuf[mi];
        if (m.id === h.id) continue;
        if (m.subspecies !== h.subspecies) continue;
        if (m.energy < config.herbivoreReproductionEnergy * 0.5) continue;
        if (m.reproductionCooldown > 0) continue;
        const mStage = m.age / m.maxAge;
        if (mStage < 0.15) continue; // not baby
        mate = m;
        break;
      }

      if (mate) {
        // Both parents pay half cost
        const halfCost = config.herbivoreReproductionCost / 2;
        h.energy -= halfCost;
        mate.energy -= halfCost;
        h.reproductionCooldown = config.herbivoreReproductionCooldownTime;
        mate.reproductionCooldown = config.herbivoreReproductionCooldownTime;
        h.offspringCount++;
        mate.offspringCount++;

        // Spawn at midpoint
        const midX = (h.pos.x + mate.pos.x) / 2;
        const midY = (h.pos.y + mate.pos.y) / 2;
        const childX = Math.max(0, Math.min(config.worldWidth - 0.1, midX + rng.range(-10, 10)));
        const childY = Math.max(0, Math.min(config.worldHeight - 0.1, midY + rng.range(-10, 10)));

        // Blend traits from both parents
        const blendedTraits = {} as HerbivoreTraits;
        const keys = Object.keys(h.traits) as (keyof HerbivoreTraits)[];
        for (const key of keys) {
          const t = 0.3 + rng.next() * 0.4; // lerp 0.3-0.7
          blendedTraits[key] = h.traits[key] * t + mate.traits[key] * (1 - t);
        }

        const child = createHerbivore(
          state.nextId++,
          childX,
          childY,
          rng,
          config,
          blendedTraits,
          h.subspecies
        );
        child.energy = config.herbivoreReproductionCost * 0.6;
        child.lineageId = h.lineageId;
        child.generation = Math.max(h.generation, mate.generation) + 1;
        events.push({ type: 'birth', creatureType: 'herbivore', x: child.pos.x, y: child.pos.y });
        newborns.push(child);
        state.herbTraitMemory.push({ ...blendedTraits });
        if (state.herbTraitMemory.length > 50) state.herbTraitMemory.shift();
      }
    }
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p10): two-parent mating system for herbivores"`

---

### Task 6: Two-Parent Mating System (Predators)

Same mating pattern for predators.

**Files:**
- Modify: `src/sim/agents.ts:1082-1116` (predator reproduction block)

**Changes:**

Replace the predator reproduction block with the same two-parent pattern. Key differences from herbivores:
- Uses `predHash` instead of `herbHash` for mate search
- Uses `PredatorTraits` for blending
- Uses `createPredator` with subspecies parameter
- Uses predator config values

```typescript
    // Reproduction: two-parent mating system
    if (
      p.energy > config.predatorReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      p.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.predators.length + newborns.length < config.maxPredators &&
      densityReproChance(state.predators.length, config.maxPredators, rng)
    ) {
      const mateBuf: Predator[] = [];
      predHash.query(p.pos, 60, mateBuf);
      let mate: Predator | null = null;
      for (let mi = 0; mi < mateBuf.length; mi++) {
        const m = mateBuf[mi];
        if (m.id === p.id) continue;
        if (m.subspecies !== p.subspecies) continue;
        if (m.energy < config.predatorReproductionEnergy * 0.5) continue;
        if (m.reproductionCooldown > 0) continue;
        const mStage = m.age / m.maxAge;
        if (mStage < 0.15) continue;
        mate = m;
        break;
      }

      if (mate) {
        const halfCost = config.predatorReproductionCost / 2;
        p.energy -= halfCost;
        mate.energy -= halfCost;
        p.reproductionCooldown = config.predatorReproductionCooldownTime;
        mate.reproductionCooldown = config.predatorReproductionCooldownTime;
        p.offspringCount++;
        mate.offspringCount++;

        const midX = (p.pos.x + mate.pos.x) / 2;
        const midY = (p.pos.y + mate.pos.y) / 2;
        const childX = Math.max(0, Math.min(config.worldWidth - 0.1, midX + rng.range(-10, 10)));
        const childY = Math.max(0, Math.min(config.worldHeight - 0.1, midY + rng.range(-10, 10)));

        const blendedTraits = {} as PredatorTraits;
        const keys = Object.keys(p.traits) as (keyof PredatorTraits)[];
        for (const key of keys) {
          const t = 0.3 + rng.next() * 0.4;
          blendedTraits[key] = p.traits[key] * t + mate.traits[key] * (1 - t);
        }

        const child = createPredator(
          state.nextId++,
          childX,
          childY,
          rng,
          config,
          blendedTraits,
          p.subspecies
        );
        child.energy = config.predatorReproductionCost * 0.6;
        child.lineageId = p.lineageId;
        child.generation = Math.max(p.generation, mate.generation) + 1;
        events.push({ type: 'birth', creatureType: 'predator', x: child.pos.x, y: child.pos.y });
        newborns.push(child);
        state.predTraitMemory.push({ ...blendedTraits });
        if (state.predTraitMemory.length > 50) state.predTraitMemory.shift();
      }
    }
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p10): two-parent mating system for predators"`

---

### Task 7: Two-Parent Mating System (Scavengers)

Same mating pattern for scavengers. The scavenger reproduction is currently on one line.

**Files:**
- Modify: `src/sim/agents.ts:1234-1258` (scavenger reproduction block)

**Changes:**

Replace the scavenger reproduction block with the two-parent pattern. Uses `scavHash` for mate search, `ScavengerTraits` for blending, `createScavenger` with subspecies. Also apply Beetle's reproduction cost multiplier:

```typescript
    // Reproduction: two-parent mating system
    if (s.energy > config.scavengerReproductionEnergy * (stage === 'elder' ? 2 : 1) && s.reproductionCooldown <= 0 && stage !== 'baby' && state.scavengers.length + newborns.length < config.maxScavengers && densityReproChance(state.scavengers.length, config.maxScavengers, rng)) {
      const mateBuf: Scavenger[] = [];
      scavHash.query(s.pos, 60, mateBuf);
      let mate: Scavenger | null = null;
      for (let mi = 0; mi < mateBuf.length; mi++) {
        const m = mateBuf[mi];
        if (m.id === s.id) continue;
        if (m.subspecies !== s.subspecies) continue;
        if (m.energy < config.scavengerReproductionEnergy * 0.5) continue;
        if (m.reproductionCooldown > 0) continue;
        const mStage = m.age / m.maxAge;
        if (mStage < 0.15) continue;
        mate = m;
        break;
      }

      if (mate) {
        const halfCost = config.scavengerReproductionCost / 2;
        s.energy -= halfCost;
        mate.energy -= halfCost;
        s.reproductionCooldown = config.scavengerReproductionCooldownTime;
        mate.reproductionCooldown = config.scavengerReproductionCooldownTime;
        s.offspringCount++;
        mate.offspringCount++;

        const midX = (s.pos.x + mate.pos.x) / 2;
        const midY = (s.pos.y + mate.pos.y) / 2;
        const childX = Math.max(0, Math.min(config.worldWidth - 0.1, midX + rng.range(-10, 10)));
        const childY = Math.max(0, Math.min(config.worldHeight - 0.1, midY + rng.range(-10, 10)));

        const blendedTraits = {} as ScavengerTraits;
        const keys = Object.keys(s.traits) as (keyof ScavengerTraits)[];
        for (const key of keys) {
          const t = 0.3 + rng.next() * 0.4;
          blendedTraits[key] = s.traits[key] * t + mate.traits[key] * (1 - t);
        }

        const child = createScavenger(
          state.nextId++,
          childX,
          childY,
          rng,
          config,
          blendedTraits,
          s.subspecies
        );
        child.energy = config.scavengerReproductionCost * 0.6;
        child.lineageId = s.lineageId;
        child.generation = Math.max(s.generation, mate.generation) + 1;
        newborns.push(child);
        state.scavTraitMemory.push({ ...blendedTraits });
        if (state.scavTraitMemory.length > 50) state.scavTraitMemory.shift();
        events.push({ type: 'birth', creatureType: 'scavenger', x: child.pos.x, y: child.pos.y });
      }
    }
```

Note: Check that `scavHash` is available in `updateScavengers`. If the scavenger update function doesn't have a scavenger spatial hash parameter, you'll need to query using a different approach — potentially using the same `herbHash` parameter pattern or creating a local query buffer from `state.scavengers` with distance checks.

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p10): two-parent mating system for scavengers"`

---

### Task 8: Mate-Seeking Behavior State

When a creature is ready to reproduce, it steers toward the nearest eligible mate.

**Files:**
- Modify: `src/sim/agents.ts` (steerHerbivore, steerPredator, steerScavenger)

**Changes:**

1. In `steerHerbivore`, before the wander noise section, add mate-seeking steering:

```typescript
  // Mate seeking: steer toward nearest eligible mate when ready to reproduce
  const herbStage = h.age / h.maxAge;
  if (
    h.energy > state.config.herbivoreReproductionEnergy &&
    h.reproductionCooldown <= 0 &&
    herbStage >= 0.15
  ) {
    const mateScan: Herbivore[] = [];
    herbHash.query(h.pos, 120, mateScan);
    let closestMate: Herbivore | null = null;
    let closestDist = Infinity;
    for (let mi = 0; mi < mateScan.length; mi++) {
      const m = mateScan[mi];
      if (m.id === h.id || m.subspecies !== h.subspecies) continue;
      if (m.energy < state.config.herbivoreReproductionEnergy * 0.5) continue;
      if (m.reproductionCooldown > 0) continue;
      const md = herbHash.wrappedDelta(h.pos, m.pos);
      const d2 = md.x * md.x + md.y * md.y;
      if (d2 < closestDist) {
        closestDist = d2;
        closestMate = m;
      }
    }
    if (closestMate) {
      const md = herbHash.wrappedDelta(h.pos, closestMate.pos);
      const d = Math.sqrt(md.x * md.x + md.y * md.y);
      if (d > 1) {
        fx += (md.x / d) * 25;
        fy += (md.y / d) * 25;
      }
      h.behavior = 'seeking mate';
    }
  }
```

2. Same pattern in `steerPredator` for predator mate-seeking (using `predHash`).

3. Same pattern in `steerScavenger` for scavenger mate-seeking. If no scavenger spatial hash exists, use a simple distance loop over `state.scavengers`.

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p10): mate-seeking behavior — creatures steer toward eligible mates"`

---

### Task 9: Subspecies Hue in Renderer

Use subspecies hue base instead of the single species color for tinting.

**Files:**
- Modify: `src/render/renderer.ts:517,595,674` (tint color lines)

**Changes:**

1. Add import at top of renderer.ts:

```typescript
import { HERB_SUBSPECIES, PRED_SUBSPECIES, SCAV_SUBSPECIES } from '../sim/subspecies';
```

2. Replace herbivore tint (line 517):

From: `const lineageTintH = hueShiftByLineage(0x5dd880, h.lineageId, 25);`
To: `const lineageTintH = hueShiftByLineage(HERB_SUBSPECIES[h.subspecies]?.hueBase || 0x5dd880, h.lineageId, HERB_SUBSPECIES[h.subspecies]?.hueRange || 20);`

3. Replace predator tint (line 595):

From: `const lineageTintP = hueShiftByLineage(0xe87744, p.lineageId, 25);`
To: `const lineageTintP = hueShiftByLineage(PRED_SUBSPECIES[p.subspecies]?.hueBase || 0xe87744, p.lineageId, PRED_SUBSPECIES[p.subspecies]?.hueRange || 20);`

4. Replace scavenger tint (line 674):

From: `const lineageTintS = hueShiftByLineage(0xd4a840, s.lineageId, 25);`
To: `const lineageTintS = hueShiftByLineage(SCAV_SUBSPECIES[s.subspecies]?.hueBase || 0xd4a840, s.lineageId, SCAV_SUBSPECIES[s.subspecies]?.hueRange || 20);`

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/render/renderer.ts && git commit -m "feat(p10): subspecies-based hue rendering — distinct colors per subspecies"`

---

### Task 10: Subspecies in Inspector and Stats

Show subspecies name in creature inspector and subspecies counts in stats.

**Files:**
- Modify: `src/ui/inspector.ts` (add subspecies name to creature card)
- Modify: `src/ui/overlay.ts` (add subspecies counts to stats)
- Modify: `src/sim/simulation.ts` (compute subspecies counts in computeStats)
- Modify: `src/sim/types.ts` (add subspecies counts to SimStats)

**Changes:**

1. In `src/sim/types.ts`, add to `SimStats` after `maxGeneration: number;`:

```typescript
  grazerCount: number;
  foragerCount: number;
  stalkerCount: number;
  packHunterCount: number;
  vultureCount: number;
  beetleCount: number;
```

2. In `src/sim/simulation.ts`, in `emptyStats()`, add:

```typescript
  grazerCount: 0,
  foragerCount: 0,
  stalkerCount: 0,
  packHunterCount: 0,
  vultureCount: 0,
  beetleCount: 0,
```

3. In `computeStats()`, compute subspecies counts:

```typescript
    let grazerCount = 0, foragerCount = 0;
    for (const h of state.herbivores) {
      if (h.subspecies === 0) grazerCount++; else foragerCount++;
    }
    stats.grazerCount = grazerCount;
    stats.foragerCount = foragerCount;

    let stalkerCount = 0, packHunterCount = 0;
    for (const p of state.predators) {
      if (p.subspecies === 0) stalkerCount++; else packHunterCount++;
    }
    stats.stalkerCount = stalkerCount;
    stats.packHunterCount = packHunterCount;

    let vultureCount = 0, beetleCount = 0;
    for (const s of state.scavengers) {
      if (s.subspecies === 0) vultureCount++; else beetleCount++;
    }
    stats.vultureCount = vultureCount;
    stats.beetleCount = beetleCount;
```

4. In `src/ui/overlay.ts`, update the stats display to show subspecies:

Replace the single herbivore/predator/scavenger count lines with subspecies breakdowns:

```typescript
      <div><span class="label">Herbivores:</span> <span class="herbivore">${stats.herbivoreCount}</span> <span style="color:#44ccaa;font-size:9px">(G:${stats.grazerCount} F:${stats.foragerCount})</span></div>
      <div><span class="label">Predators:</span> <span class="predator">${stats.predatorCount}</span> <span style="color:#ee6644;font-size:9px">(S:${stats.stalkerCount} P:${stats.packHunterCount})</span></div>
      <div><span class="label">Scavengers:</span> <span class="value" style="color: #ccaa44">${stats.scavengerCount}</span> <span style="color:#ccaa44;font-size:9px">(V:${stats.vultureCount} B:${stats.beetleCount})</span></div>
```

5. In `src/ui/inspector.ts`, add subspecies name to creature card. Find where lineage/generation is displayed and add:

```typescript
      <div class="inspector-trait"><span>Species</span><span>${getSubspeciesName(creature.type, creature.subspecies)}</span></div>
```

Add import: `import { getSubspeciesName } from '../sim/subspecies';`

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/simulation.ts src/ui/overlay.ts src/ui/inspector.ts && git commit -m "feat(p10): subspecies names in inspector and stats panel"`

---

### Task 11: Simulation Speed — Halve Base Rate

**Files:**
- Modify: `src/main.ts:218` (accumulator speed line)

**Changes:**

1. In `src/main.ts`, change line 218 from:

```typescript
      this.accumulator += elapsed * this.speed;
```

to:

```typescript
      this.accumulator += elapsed * this.speed * 0.5;
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/main.ts && git commit -m "feat(p10): halve base sim speed for cinematic pacing"`

---

### Task 12: Population Graph as Draggable Box

Convert the full-width bottom graph to a 350x120 draggable box.

**Files:**
- Modify: `src/ui/graph.ts` (fixed width, add drag wrapper)
- Modify: `src/styles.css:256-262` (#population-graph styles)
- Modify: `src/main.ts` (wire up draggable)

**Changes:**

1. In `src/styles.css`, replace the `#population-graph` rule (lines 256-262) with:

```css
#population-graph-panel {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 350px;
  background: rgba(10, 10, 15, 0.85);
  border: 1px solid #223344;
  border-radius: 6px;
  padding: 6px;
  pointer-events: auto;
  z-index: 10;
}

#population-graph-panel .graph-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: grab;
  color: #667788;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
  user-select: none;
}

#population-graph {
  width: 100%;
  height: 100px;
  display: block;
}
```

2. In `src/ui/graph.ts`, wrap the canvas in a panel div. Modify the constructor:

```typescript
  private panel: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.id = 'population-graph-panel';
    this.panel.innerHTML = '<div class="graph-header"><span>Population</span></div>';
    container.appendChild(this.panel);

    this.traitCanvas = document.createElement('canvas');
    this.traitCanvas.id = 'trait-sparklines';
    this.traitCanvas.height = SPARKLINE_HEIGHT;
    this.traitCanvas.style.display = 'none';
    this.panel.appendChild(this.traitCanvas);

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'population-graph';
    this.canvas.height = GRAPH_HEIGHT;
    this.panel.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.traitCtx = this.traitCanvas.getContext('2d')!;
    this.resize();
  }
```

3. Update `resize()` to use panel width:

```typescript
  resize(): void {
    const w = this.panel.clientWidth - 12; // padding
    this.canvas.width = w;
    this.canvas.style.width = w + 'px';
    this.traitCanvas.width = w;
    this.traitCanvas.style.width = w + 'px';
  }
```

4. Update `setVisible` to toggle panel:

```typescript
  setVisible(v: boolean): void {
    this.visible = v;
    this.panel.style.display = v ? 'block' : 'none';
  }
```

5. Add a `getPanel()` method for draggable wiring:

```typescript
  getPanel(): HTMLDivElement { return this.panel; }
  getHeader(): HTMLElement { return this.panel.querySelector('.graph-header')! as HTMLElement; }
```

6. In `src/main.ts`, after creating the graph (line 84), wire up draggable:

```typescript
    makeDraggable(this.graph.getPanel(), this.graph.getHeader());
```

Make sure `makeDraggable` is imported (it should already be from the draggable UI work).

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/ui/graph.ts src/styles.css src/main.ts && git commit -m "feat(p10): population graph as draggable 350x120 box"`

---

### Task 13: Fix Settings Panel Expansion Direction

Settings panel at top-right should expand down-left so it doesn't go off-screen.

**Files:**
- Modify: `src/styles.css:110-121` (#settings styles)

**Changes:**

1. In `src/styles.css`, update the `#settings` rule. Add `max-height` and ensure it expands leftward by anchoring to the right:

```css
#settings {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(10, 10, 15, 0.88);
  border: 1px solid #223344;
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 11px;
  pointer-events: auto;
  min-width: 200px;
  max-width: 280px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}
```

The key additions are `max-width: 280px` to prevent horizontal overflow and `max-height: calc(100vh - 40px)` with `overflow-y: auto` so the content scrolls if it's taller than the viewport. Since `right: 16px` is already set, the panel naturally expands leftward.

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/styles.css && git commit -m "fix: settings panel expands down-left within viewport bounds"`

---

### Task 14: Reintroduction Compatibility

Update reintroduction logic in simulation.ts to pass subspecies when creating reintroduced creatures.

**Files:**
- Modify: `src/sim/simulation.ts` (reintroduction blocks)

**Changes:**

In the reintroduction blocks, when calling `createHerbivore`, `createPredator`, and `createScavenger`, pass a random subspecies. The creation functions already default to random if not passed, but explicitly pass it for clarity:

Find each `createHerbivore(` call in the reintroduction section and ensure the signature matches the updated function. Since the new `subspecies` parameter is optional and defaults to random, the existing calls should still work. But verify that `traits` parameter is being passed correctly — the `avgTraits` result goes into `parentTraits`, and `subspecies` should be randomized.

If the existing calls like:
```typescript
createHerbivore(state.nextId++, x, y, this.rng, config, traits || undefined)
```
compile cleanly, no changes are needed since the `subspecies` parameter defaults to random.

**Verify:** `npx tsc --noEmit`

**Commit:** Only commit if changes were needed.

---

### Task 15: Screenshot + Final Build Verification

**Steps:**

1. `npx tsc --noEmit` — 0 errors
2. `npx vite build` — success
3. Take screenshot at 15s: `node debug/screenshot.mjs 15000 phase10-15s.png`
4. Take screenshot at 45s: `node debug/screenshot.mjs 45000 phase10-45s.png`
5. Visual check:
   - Two distinct herbivore colors visible (blue-green Grazers, yellow-green Foragers)
   - Two distinct predator colors (orange Stalkers, purple Pack Hunters)
   - Two distinct scavenger colors (pale gold Vultures, dark amber Beetles)
   - Predators surviving and reproducing (non-zero count in stats)
   - Stats panel shows subspecies breakdowns (G:/F:, S:/P:, V:/B:)
   - Population graph is a box in bottom-right, not full width
   - Settings panel doesn't overflow when expanded
   - Sim speed feels slower/more cinematic at 1x
   - Creatures visibly seek mates before reproducing
