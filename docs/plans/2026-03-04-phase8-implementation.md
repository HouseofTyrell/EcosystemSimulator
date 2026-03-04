# Phase 8: Tuning & Thriving — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the simulator into a large-scale Lotka-Volterra oscillator supporting ~1000 creatures at 60 FPS, with adaptive reintroduction preventing permanent extinction.

**Architecture:** Five changes to existing systems — no new files. Raise population caps and add density-dependent reproduction pressure (logistic growth). Add predator satiation to create delayed feedback loops. Record trait snapshots for adaptive reintroduction. Rebalance plant growth and energy thresholds. Add rendering LOD (viewport culling, detail reduction at distance, particle caps) for 60 FPS at scale.

**Tech Stack:** TypeScript, PixiJS v8, Vite

---

## Task 1: Raise Population Caps

**Files:**
- Modify: `src/sim/types.ts:264-266` (DEFAULT_CONFIG max values)
- Modify: `src/main.ts:291-298` (updatePopCaps method)

**Step 1: Update DEFAULT_CONFIG in types.ts**

In `src/sim/types.ts`, change lines 264-266 from:

```typescript
  maxHerbivores: 60,
  maxPredators: 20,
  maxScavengers: 15,
```

to:

```typescript
  maxHerbivores: 800,
  maxPredators: 250,
  maxScavengers: 150,
```

**Step 2: Update updatePopCaps in main.ts**

In `src/main.ts`, change lines 291-298 from:

```typescript
  private updatePopCaps(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = (w * h) / (1920 * 1080);
    this.sim.state.config.maxHerbivores = Math.floor(60 * scale);
    this.sim.state.config.maxPredators = Math.floor(20 * scale);
    this.sim.state.config.maxScavengers = Math.floor(15 * scale);
  }
```

to:

```typescript
  private updatePopCaps(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = (w * h) / (1920 * 1080);
    this.sim.state.config.maxHerbivores = Math.floor(800 * scale);
    this.sim.state.config.maxPredators = Math.floor(250 * scale);
    this.sim.state.config.maxScavengers = Math.floor(150 * scale);
  }
```

**Step 3: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/sim/types.ts src/main.ts
git commit -m "feat(p8): raise population caps to 800/250/150 baseline"
```

---

## Task 2: Density-Dependent Reproduction

**Files:**
- Modify: `src/sim/agents.ts:807-812` (herbivore reproduction check)
- Modify: `src/sim/agents.ts:971-976` (predator reproduction check)
- Modify: `src/sim/agents.ts:1120` (scavenger reproduction check)

**Context:** Currently, reproduction is blocked only by a hard cap check (e.g. `state.herbivores.length < config.maxHerbivores`). We add a density-dependent probability that smoothly reduces reproduction as population approaches a soft cap at 70% of the hard cap. This creates logistic growth — the mathematical foundation of Lotka-Volterra oscillations.

**Step 1: Add density reproduction check helper at the top of agents.ts**

Near the top of `src/sim/agents.ts`, after the existing imports and before the first export function, add:

```typescript
/** Density-dependent reproduction probability. Returns 0-1. */
function densityReproChance(currentPop: number, hardCap: number, rng: SeededRNG): boolean {
  const softCap = hardCap * 0.7;
  if (currentPop >= hardCap) return false;
  const ratio = currentPop / softCap;
  const chance = Math.max(0, 1 - ratio * ratio);
  return rng.next() < chance;
}
```

**Step 2: Wire into herbivore reproduction**

In `src/sim/agents.ts`, find the herbivore reproduction block (around line 808). Change the condition from:

```typescript
    if (
      h.energy > config.herbivoreReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      h.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.herbivores.length + newborns.length < config.maxHerbivores
    ) {
```

to:

```typescript
    if (
      h.energy > config.herbivoreReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      h.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.herbivores.length + newborns.length < config.maxHerbivores &&
      densityReproChance(state.herbivores.length, config.maxHerbivores, rng)
    ) {
```

**Step 3: Wire into predator reproduction**

In `src/sim/agents.ts`, find the predator reproduction block (around line 972). Change the condition from:

```typescript
    if (
      p.energy > config.predatorReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      p.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.predators.length + newborns.length < config.maxPredators
    ) {
```

to:

```typescript
    if (
      p.energy > config.predatorReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      p.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.predators.length + newborns.length < config.maxPredators &&
      densityReproChance(state.predators.length, config.maxPredators, rng)
    ) {
```

**Step 4: Wire into scavenger reproduction**

In `src/sim/agents.ts`, find the scavenger reproduction block (around line 1120). The condition is all on one line. Change from:

```typescript
    if (s.energy > config.scavengerReproductionEnergy * (stage === 'elder' ? 2 : 1) && s.reproductionCooldown <= 0 && stage !== 'baby' && state.scavengers.length + newborns.length < config.maxScavengers) {
```

to:

```typescript
    if (s.energy > config.scavengerReproductionEnergy * (stage === 'elder' ? 2 : 1) && s.reproductionCooldown <= 0 && stage !== 'baby' && state.scavengers.length + newborns.length < config.maxScavengers && densityReproChance(state.scavengers.length, config.maxScavengers, rng)) {
```

**Step 5: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/sim/agents.ts
git commit -m "feat(p8): density-dependent reproduction — logistic growth curve"
```

---

## Task 3: Predator Satiation

**Files:**
- Modify: `src/sim/agents.ts:478-525` (steerPredator target acquisition)

**Context:** Currently predators always hunt. With satiation, predators with energy > 80% of reproduction threshold stop chasing prey and wander instead. This is the critical mechanism that lets herbivore populations recover after a crash — without it, efficient predators drive prey to extinction every cycle.

**Step 1: Add satiation check in steerPredator**

In `src/sim/agents.ts`, in the `steerPredator` function, find the target acquisition section that starts around line 491 with:

```typescript
  // 1) Attraction to herbivores (scored targeting, scaled by hunger)
  const herbBuf: Herbivore[] = [];
  herbHash.query(p.pos, vision, herbBuf);
```

Add a satiation check **before** this block. Insert right before the `// 1) Attraction to herbivores` comment:

```typescript
  // Satiation: well-fed predators don't hunt (lets prey recover)
  const satiationThreshold = state.config.predatorReproductionEnergy * 0.8;
  const isSatiated = p.energy > satiationThreshold;
```

Then wrap the entire herbivore targeting block in an `if (!isSatiated)` check. Find:

```typescript
  // 1) Attraction to herbivores (scored targeting, scaled by hunger)
  const herbBuf: Herbivore[] = [];
  herbHash.query(p.pos, vision, herbBuf);
```

Change to:

```typescript
  // 1) Attraction to herbivores (scored targeting, scaled by hunger)
  // Satiated predators skip hunting entirely
  if (!isSatiated) {
  const herbBuf: Herbivore[] = [];
  herbHash.query(p.pos, vision, herbBuf);
```

Then find the closing of the herbivore targeting block. It ends around line 524-525 with:

```typescript
      fx += (bestDelta.x / bestDist) * strength;
      fy += (bestDelta.y / bestDist) * strength;
    }
  }
```

After that closing brace `}`, add a closing brace for the `if (!isSatiated)` block:

```typescript
      fx += (bestDelta.x / bestDist) * strength;
      fy += (bestDelta.y / bestDist) * strength;
    }
  }
  } // end satiation check
```

**Step 2: Also skip attacks when satiated**

In `updatePredators`, find the attack logic block (around line 876-902 where it checks attack range and kill chance). Find the line that starts the attack check — look for `attackTimer` or attack range check. Before the attack block, add the same satiation check.

Find the attack block that looks like:

```typescript
    // Attack
    if (p.attackTimer <= 0) {
```

Wrap it so satiated predators skip attacking:

```typescript
    // Attack — satiated predators don't attack
    if (p.attackTimer <= 0 && p.energy <= config.predatorReproductionEnergy * 0.8) {
```

**Step 3: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/sim/agents.ts
git commit -m "feat(p8): predator satiation — well-fed predators stop hunting"
```

---

## Task 4: Trait Memory & Adaptive Reintroduction

**Files:**
- Modify: `src/sim/types.ts:148-171` (SimState — add trait memory fields)
- Modify: `src/sim/simulation.ts:338-377` (reintroduction logic)
- Modify: `src/sim/agents.ts` (record trait snapshots on reproduction)

**Context:** Currently reintroduction spawns 5 herbivores / 2 predators / 3 scavengers with default random traits and low energy. They frequently die before reproducing. The fix: track the last 50 successful reproduction trait snapshots per species, and use those averages when reintroducing. Spawn more creatures with full energy.

**Step 1: Add trait memory arrays to SimState in types.ts**

In `src/sim/types.ts`, add these fields to the `SimState` interface (after `soilHealth: Float32Array;` around line 170):

```typescript
  // Trait memory for adaptive reintroduction
  herbTraitMemory: HerbivoreTraits[];
  predTraitMemory: PredatorTraits[];
  scavTraitMemory: ScavengerTraits[];
  reintroductionTime: number; // sim time of last reintroduction (for disease immunity)
```

**Step 2: Initialize trait memory in simulation.ts**

In `src/sim/simulation.ts`, find where `SimState` is constructed in the `reset` method. Add initialization for the new fields alongside the other state fields:

```typescript
    state.herbTraitMemory = [];
    state.predTraitMemory = [];
    state.scavTraitMemory = [];
    state.reintroductionTime = -Infinity;
```

**Step 3: Record trait snapshots on reproduction in agents.ts**

In `src/sim/agents.ts`, in the herbivore reproduction block (around line 836, right after `newborns.push(child);`), add:

```typescript
      // Record parent traits for adaptive reintroduction
      state.herbTraitMemory.push({ ...h.traits });
      if (state.herbTraitMemory.length > 50) state.herbTraitMemory.shift();
```

In the predator reproduction block (around line 1001, right after `newborns.push(child);`), add:

```typescript
      state.predTraitMemory.push({ ...p.traits });
      if (state.predTraitMemory.length > 50) state.predTraitMemory.shift();
```

In the scavenger reproduction block (around line 1141, right after `newborns.push(child);`), add:

```typescript
      state.scavTraitMemory.push({ ...s.traits });
      if (state.scavTraitMemory.length > 50) state.scavTraitMemory.shift();
```

**Step 4: Rewrite reintroduction logic in simulation.ts**

Replace the entire extinction recovery block in `src/sim/simulation.ts` (lines 338-377) with:

```typescript
    // Extinction recovery: adaptive reintroduction with trait memory
    if (state.herbivores.length === 0 && this.rng.next() < 0.02) {
      const traits = avgTraits(state.herbTraitMemory) as HerbivoreTraits | null;
      for (let i = 0; i < 15; i++) {
        const h = createHerbivore(
          state.nextId++,
          this.rng.range(0, config.worldWidth),
          this.rng.range(0, config.worldHeight),
          this.rng,
          config,
          traits || undefined
        );
        h.energy = config.herbivoreReproductionEnergy;
        state.herbivores.push(h);
      }
      state.reintroductionTime = state.time;
    }
    if (state.predators.length === 0 && state.herbivores.length > 10 && this.rng.next() < 0.01) {
      const traits = avgTraits(state.predTraitMemory) as PredatorTraits | null;
      for (let i = 0; i < 6; i++) {
        const p = createPredator(
          state.nextId++,
          this.rng.range(0, config.worldWidth),
          this.rng.range(0, config.worldHeight),
          this.rng,
          config,
          traits || undefined
        );
        p.energy = config.predatorReproductionEnergy;
        state.predators.push(p);
      }
      state.reintroductionTime = state.time;
    }
    if (state.scavengers.length === 0 && state.corpses.length > 2 && this.rng.next() < 0.01) {
      const traits = avgTraits(state.scavTraitMemory) as ScavengerTraits | null;
      for (let i = 0; i < 8; i++) {
        const s = createScavenger(
          state.nextId++,
          this.rng.range(0, config.worldWidth),
          this.rng.range(0, config.worldHeight),
          this.rng,
          config,
          traits || undefined
        );
        s.energy = config.scavengerReproductionEnergy;
        state.scavengers.push(s);
      }
      state.reintroductionTime = state.time;
    }
```

**Step 5: Add avgTraits helper in simulation.ts**

Add this helper function near the top of `src/sim/simulation.ts` (after imports):

```typescript
/** Average trait snapshots for adaptive reintroduction. Returns null if no memory. */
function avgTraits<T extends Record<string, number>>(memory: T[]): T | null {
  if (memory.length === 0) return null;
  const result = { ...memory[0] };
  for (const key of Object.keys(result)) {
    let sum = 0;
    for (let i = 0; i < memory.length; i++) {
      sum += memory[i][key as keyof T] as number;
    }
    (result as Record<string, number>)[key] = sum / memory.length;
  }
  return result;
}
```

**Step 6: Add disease immunity for recently reintroduced species**

In `src/sim/events.ts`, in the `applyDisease` function (around line 53), after the `if (!targets || targets.length === 0) return;` check, add:

```typescript
  // Don't target species within 10s of reintroduction
  if (state.time - state.reintroductionTime < 10) return;
```

**Step 7: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 8: Commit**

```bash
git add src/sim/types.ts src/sim/simulation.ts src/sim/agents.ts src/sim/events.ts
git commit -m "feat(p8): adaptive reintroduction with trait memory"
```

---

## Task 5: Plant & Energy Rebalance

**Files:**
- Modify: `src/sim/types.ts:223-267` (DEFAULT_CONFIG values)
- Modify: `src/sim/events.ts:55` (disease initial infection count)
- Modify: `src/sim/agents.ts` (disease damage rate)

**Step 1: Update DEFAULT_CONFIG values in types.ts**

In `src/sim/types.ts`, in the `DEFAULT_CONFIG` object, change these values:

```
plantGrowthRate: 0.20 → 0.35
herbivoreReproductionEnergy: 105 → 80
predatorReproductionEnergy: 130 → 100
scavengerReproductionEnergy: 80 → 60
```

**Step 2: Reduce disease initial infections in events.ts**

In `src/sim/events.ts`, find line 55:

```typescript
  const count = Math.min(2 + Math.floor(rng.next() * 2), targets.length); // 2-3 initial infections
```

Change to:

```typescript
  const count = Math.min(1 + Math.floor(rng.next() * 2), targets.length); // 1-2 initial infections
```

**Step 3: Reduce disease damage rate in agents.ts**

In `src/sim/agents.ts`, search for the disease damage lines. There should be 3 occurrences (one per species) that look like:

```typescript
      h.energy -= 3 * dt; // disease damage
```

Change all three from `3 * dt` to `2 * dt`:

```typescript
      h.energy -= 2 * dt; // disease damage
```

Do the same for predators and scavengers (same pattern with `p.energy` and `s.energy`).

**Step 4: Update settings panel slider ranges in overlay.ts**

In `src/ui/overlay.ts`, find the settings sliders for reproduction energy. Update the slider defaults to match new values:

- Herb Repro Energy: `value="105"` → `value="80"`
- Pred Repro Energy: `value="130"` → `value="100"`
- Scav Repro Energy: `value="80"` → `value="60"`
- Plant Growth: `value="20"` → `value="35"`

Also update their `<span class="val">` display values to match.

**Step 5: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/sim/types.ts src/sim/events.ts src/sim/agents.ts src/ui/overlay.ts
git commit -m "feat(p8): rebalance plant growth, reproduction thresholds, disease severity"
```

---

## Task 6: Rendering LOD — Viewport Culling

**Files:**
- Modify: `src/render/renderer.ts:483-646` (creature rendering sections)

**Context:** With up to 1000 creatures, we must skip rendering for offscreen creatures. The camera transform gives us the visible viewport in world coordinates. Any creature outside this area (with a margin) gets skipped entirely.

**Step 1: Add viewport bounds calculation at the start of the render method**

In `src/render/renderer.ts`, in the `render` method, after the camera transform block (around line 312), add:

```typescript
    // Viewport culling bounds (in world coordinates)
    const zoom = camera?.zoom || 1;
    const cx = camera?.x || this.worldW / 2;
    const cy = camera?.y || this.worldH / 2;
    const halfW = (this.worldW / zoom) / 2;
    const halfH = (this.worldH / zoom) / 2;
    const margin = 100 / zoom; // 100px margin in screen space
    const cullLeft = (cx - halfW - margin) / scaleX;
    const cullRight = (cx + halfW + margin) / scaleX;
    const cullTop = (cy - halfH - margin) / scaleY;
    const cullBottom = (cy + halfH + margin) / scaleY;
```

**Step 2: Add culling to herbivore rendering**

In the herbivore rendering loop (around line 484), add a cull check at the start of the loop body. After `const h = state.herbivores[i];`, add:

```typescript
      // Viewport culling
      if (h.pos.x < cullLeft || h.pos.x > cullRight || h.pos.y < cullTop || h.pos.y > cullBottom) continue;
```

**Step 3: Add culling to predator rendering**

Same pattern in the predator loop (around line 540). After `const p = state.predators[i];`, add:

```typescript
      if (p.pos.x < cullLeft || p.pos.x > cullRight || p.pos.y < cullTop || p.pos.y > cullBottom) continue;
```

**Step 4: Add culling to scavenger rendering**

Same pattern in the scavenger loop (around line 598). After `const s = state.scavengers[i];`, add:

```typescript
      if (s.pos.x < cullLeft || s.pos.x > cullRight || s.pos.y < cullTop || s.pos.y > cullBottom) continue;
```

**Step 5: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(p8): viewport culling — skip rendering offscreen creatures"
```

---

## Task 7: Rendering LOD — Detail Reduction at Distance

**Files:**
- Modify: `src/render/renderer.ts:483-646` (creature rendering sections)

**Context:** When zoomed out far enough that creatures are tiny on screen, we skip expensive per-creature effects: glow rings, shadows, breathing/prowl animations, and life stage tinting. Just render the base sprite with correct position, tint, and scale.

**Step 1: Add LOD flag calculation after viewport bounds**

After the viewport culling bounds (added in Task 6), add:

```typescript
    // LOD: skip per-creature effects when creatures are tiny on screen
    const creatureScreenPx = 4 * zoom; // approximate creature screen size at default scale
    const lowDetail = creatureScreenPx < 4; // creatures smaller than 4px
    const totalCreatures = state.herbivores.length + state.predators.length + state.scavengers.length;
    const skipParticles = totalCreatures > 300;
```

**Step 2: Add LOD to herbivore rendering**

In the herbivore rendering loop, after the viewport culling `continue`, restructure to skip expensive effects when `lowDetail` is true. Replace the full herbivore rendering block (from sprite acquisition to the selection ring) with:

```typescript
      const sprite = this.herbPool.acquire();
      sprite.x = h.pos.x * scaleX;
      sprite.y = h.pos.y * scaleY;
      const lineageTintH = hueShiftByLineage(0x5dd880, h.lineageId, 25);
      sprite.tint = lineageTintH;
      sprite.rotation = Math.atan2(h.vel.y, h.vel.x);

      if (lowDetail) {
        // Minimal rendering: just sprite with base scale
        sprite.scale.set(h.traits.size * scaleX * 0.28);
        sprite.alpha = 0.85;
      } else {
        // Full rendering with life stage, breathing, glow, shadow
        const life = getLifeVisuals(h.age, h.maxAge);
        if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTintH, life.tintMix);
        const baseScale = h.traits.size * scaleX * 0.28 * life.scaleMul;
        const breathe = 1 + 0.04 * Math.sin(time * 3 + h.id * 0.7);
        sprite.scale.set(baseScale * breathe);

        let alpha = 0.8 + Math.min(h.traits.visionRange / 150, 1) * 0.2;
        if (h.energy < 25) alpha *= Math.max(0.5, h.energy / 25);
        sprite.alpha = alpha;

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
```

**Step 3: Add LOD to predator rendering**

Same pattern for predators. Replace the full predator rendering block with:

```typescript
      const sprite = this.predPool.acquire();
      sprite.x = p.pos.x * scaleX;
      sprite.y = p.pos.y * scaleY;
      const lineageTintP = hueShiftByLineage(0xe87744, p.lineageId, 25);
      sprite.tint = lineageTintP;
      sprite.rotation = Math.atan2(p.vel.y, p.vel.x);

      if (lowDetail) {
        sprite.scale.set(p.traits.size * scaleX * 0.28);
        sprite.alpha = 0.85;
      } else {
        const life = getLifeVisuals(p.age, p.maxAge);
        if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTintP, life.tintMix);
        const baseScale = p.traits.size * scaleX * 0.28 * life.scaleMul;
        const prowlPhase = Math.sin(time * 4 + p.id * 0.5);
        const sx = baseScale * (1 + 0.06 * prowlPhase);
        const sy = baseScale * (1 - 0.03 * prowlPhase);
        sprite.scale.set(sx, sy);

        let alpha = 0.85 + Math.min(p.traits.visionRange / 200, 1) * 0.15;
        if (p.energy < 25) alpha *= Math.max(0.5, p.energy / 25);
        sprite.alpha = alpha;

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
```

**Step 4: Add LOD to scavenger rendering**

Same pattern for scavengers:

```typescript
      const sprite = this.scavPool.acquire();
      sprite.x = s.pos.x * scaleX;
      sprite.y = s.pos.y * scaleY;
      const lineageTintS = hueShiftByLineage(0xd4a840, s.lineageId, 25);
      sprite.tint = lineageTintS;
      sprite.rotation = Math.atan2(s.vel.y, s.vel.x);

      if (lowDetail) {
        sprite.scale.set(s.traits.size * scaleX * 0.28);
        sprite.alpha = 0.85;
      } else {
        const life = getLifeVisuals(s.age, s.maxAge);
        if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTintS, life.tintMix);
        const baseScale = s.traits.size * scaleX * 0.28 * life.scaleMul;
        const breathe = 1 + 0.04 * Math.sin(time * 2.5 + s.id * 0.9);
        sprite.scale.set(baseScale * breathe);
        let alpha = 0.8 + Math.min(s.traits.visionRange / 150, 1) * 0.2;
        if (s.energy < 25) alpha *= Math.max(0.5, s.energy / 25);
        sprite.alpha = alpha;

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
```

**Step 5: Cap particle bursts for birth/death events at high populations**

In the event processing section (around line 648), find the birth/death particle creation. Wrap the birth particle creation in a `skipParticles` check:

Find:
```typescript
      if (ev.type === 'death') {
```

Before this line, add:
```typescript
      if (skipParticles && !(selectedIds && selectedIds.includes(0))) continue; // Skip particles at high pop
```

Actually, a better approach — we want to skip the entire particle burst at high populations UNLESS it's for an inspected creature. Since events don't carry creature IDs, just skip all event particles when `skipParticles` is true:

Before the event processing loop:
```typescript
    // Skip birth/death particle effects at high populations for performance
    if (!skipParticles) {
```

After the event processing loop's closing brace:
```typescript
    } // end skipParticles check
```

**Step 6: Cap ambient particles**

In the ambient particle section (around line 724), change:

```typescript
    const maxAmbient = isNight ? 60 : 40;
```

to:

```typescript
    const maxAmbient = 40; // Fixed cap for performance at scale
```

**Step 7: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 8: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(p8): rendering LOD — detail reduction, particle caps"
```

---

## Task 8: Pre-allocate Sprite Pools

**Files:**
- Modify: `src/render/sprite-pool.ts` (add preallocate method)
- Modify: `src/render/renderer.ts:260-267` (call preallocate after pool creation)

**Step 1: Add preallocate method to SpritePool**

In `src/render/sprite-pool.ts`, after the `releaseAll()` method, add:

```typescript
  preallocate(count: number): void {
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.container.addChild(sprite);
      this.pool.push(sprite);
    }
  }
```

**Step 2: Pre-allocate pools in renderer.ts**

In `src/render/renderer.ts`, after pool creation (around line 267), add:

```typescript
    // Pre-allocate for up to 1000 creatures to avoid runtime stalls
    this.herbPool.preallocate(800);
    this.predPool.preallocate(250);
    this.scavPool.preallocate(150);
    this.glowPool.preallocate(1200); // creatures + selection rings
    this.shadowPool.preallocate(1200);
```

**Step 3: Verify TypeScript compilation**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/render/sprite-pool.ts src/render/renderer.ts
git commit -m "feat(p8): pre-allocate sprite pools for 1000+ creatures"
```

---

## Task 9: Final Verification

**Files:** None (verification only)

**Step 1: Run TypeScript compiler**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx tsc --noEmit`
Expected: 0 errors

**Step 2: Run production build**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx vite build`
Expected: Build succeeds with no errors

**Step 3: Run dev server and verify visually**

Run: `cd "/Users/housetyrell/Documents/Programming Projects/Simulator" && npx vite --open`

Verify:
1. Simulation starts with 12 herbivores, 3 predators, 5 scavengers (same as before)
2. Populations grow beyond previous 60/20/15 caps
3. Growth rate slows as populations increase (density-dependent reproduction)
4. Predators stop chasing when well-fed (observe via tooltip — behavior should show 'wander' when energy is high)
5. If a species goes extinct, reintroduction spawns 15/6/8 creatures with full energy
6. FPS stays at 60 when zoomed out with large populations
7. Settings panel sliders reflect new default values (80/100/60 for reproduction energy)
8. At 4x speed, populations should show oscillation patterns within a few minutes

**Step 4: Commit design + plan docs**

```bash
git add docs/plans/2026-03-04-phase8-tuning-design.md docs/plans/2026-03-04-phase8-implementation.md
git commit -m "docs: Phase 8 tuning design + implementation plan"
```
