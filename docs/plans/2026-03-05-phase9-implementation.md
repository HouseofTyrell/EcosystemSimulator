# Phase 9: YouTube-Ready Simulation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix edge clumping, add territorial herding, tune population oscillations for dramatic 3-4 minute boom-bust cycles, and enhance the population graph for timelapse videos.

**Architecture:** Four changes to existing systems. Replace hard wall bounce with soft boundary repulsion steering. Add lineage-aware cohesion + birth position memory for territorial herds. Tune density reproduction and predator metabolism for guaranteed Lotka-Volterra oscillations. Enhance existing population graph with current-value labels and larger display.

**Tech Stack:** TypeScript, PixiJS v8, Vite

---

### Task 1: Soft Boundary Repulsion

Replace hard wall bounce with a smooth repulsion zone. Creatures steer away from edges before hitting them.

**Files:**
- Modify: `src/sim/agents.ts:24-30` (add helper after densityReproChance)
- Modify: `src/sim/agents.ts:789-793` (herbivore wall bounce)
- Modify: `src/sim/agents.ts:956-960` (predator wall bounce)
- Modify: `src/sim/agents.ts:1109-1113` (scavenger wall bounce)
- Modify: `src/sim/agents.ts:339-485` (steerHerbivore — call boundary repulsion)
- Modify: `src/sim/agents.ts:487-593` (steerPredator — call boundary repulsion)
- Modify: `src/sim/agents.ts:595-687` (steerScavenger — call boundary repulsion)

**Changes:**

1. Add boundary repulsion helper after `densityReproChance` (after line 30):

```typescript
/** Soft boundary repulsion. Returns steering force pushing away from edges. */
function boundaryRepulsion(pos: Vec2, config: SimConfig): Vec2 {
  const margin = 120;
  const strength = 200;
  let fx = 0, fy = 0;

  if (pos.x < margin) {
    const t = 1 - pos.x / margin;
    fx += strength * t * t;
  } else if (pos.x > config.worldWidth - margin) {
    const t = 1 - (config.worldWidth - pos.x) / margin;
    fx -= strength * t * t;
  }

  if (pos.y < margin) {
    const t = 1 - pos.y / margin;
    fy += strength * t * t;
  } else if (pos.y > config.worldHeight - margin) {
    const t = 1 - (config.worldHeight - pos.y) / margin;
    fy -= strength * t * t;
  }

  return { x: fx, y: fy };
}
```

2. In `steerHerbivore`, before the final return (around line 480), add:

```typescript
  // Soft boundary repulsion
  const bnd = boundaryRepulsion(h.pos, state.config);
  fx += bnd.x;
  fy += bnd.y;
```

3. In `steerPredator`, before the final return (around line 588), add:

```typescript
  const bnd = boundaryRepulsion(p.pos, state.config);
  fx += bnd.x;
  fy += bnd.y;
```

4. In `steerScavenger`, before the final return (around line 682), add:

```typescript
  const bnd = boundaryRepulsion(s.pos, state.config);
  fx += bnd.x;
  fy += bnd.y;
```

5. Replace herbivore wall bounce (lines 789-793) — remove velocity reversal, keep position clamping only:

```typescript
      if (h.pos.x < 0) h.pos.x = 0;
      else if (h.pos.x >= config.worldWidth) h.pos.x = config.worldWidth - 0.1;
      if (h.pos.y < 0) h.pos.y = 0;
      else if (h.pos.y >= config.worldHeight) h.pos.y = config.worldHeight - 0.1;
```

6. Same for predators (lines 956-960):

```typescript
      if (p.pos.x < 0) p.pos.x = 0;
      else if (p.pos.x >= config.worldWidth) p.pos.x = config.worldWidth - 0.1;
      if (p.pos.y < 0) p.pos.y = 0;
      else if (p.pos.y >= config.worldHeight) p.pos.y = config.worldHeight - 0.1;
```

7. Same for scavengers (lines 1109-1113):

```typescript
      if (s.pos.x < 0) s.pos.x = 0;
      else if (s.pos.x >= config.worldWidth) s.pos.x = config.worldWidth - 0.1;
      if (s.pos.y < 0) s.pos.y = 0;
      else if (s.pos.y >= config.worldHeight) s.pos.y = config.worldHeight - 0.1;
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p9): soft boundary repulsion replaces hard wall bounce"`

---

### Task 2: Birth Position Memory on Agent

Add `birthPos` field so creatures can drift back toward their birthplace, creating territorial herds.

**Files:**
- Modify: `src/sim/types.ts:39-59` (Agent interface)
- Modify: `src/sim/agents.ts:176-198` (createHerbivore return)
- Modify: `src/sim/agents.ts:223-246` (createPredator return)
- Modify: `src/sim/agents.ts:270-292` (createScavenger return)

**Changes:**

1. In `src/sim/types.ts`, add to `Agent` interface after `infected: number;` (line 59):

```typescript
  birthPos: Vec2;
```

2. In `src/sim/agents.ts`, in `createHerbivore` return object (around line 196), add before `traits,`:

```typescript
    birthPos: { x, y },
```

3. In `createPredator` return object (around line 244), add before `traits,`:

```typescript
    birthPos: { x, y },
```

4. In `createScavenger` return object (around line 290), add before `traits,`:

```typescript
    birthPos: { x, y },
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/agents.ts && git commit -m "feat(p9): add birthPos field to Agent for territorial memory"`

---

### Task 3: Lineage-Aware Cohesion + Home Drift for Herbivores

Strengthen cohesion for same-lineage herbivores, weaken for others. Add gentle drift toward birthplace.

**Files:**
- Modify: `src/sim/agents.ts:424-441` (herbivore cohesion section in steerHerbivore)

**Changes:**

1. Replace the cohesion block (lines 424-441) with lineage-aware cohesion:

```typescript
  // 3c) Cohesion: steer toward center of nearby same-lineage herbivores (stronger)
  if (herbBuf.length > 1) {
    let sameX = 0, sameY = 0, sameCount = 0;
    let otherX = 0, otherY = 0, otherCount = 0;
    for (let i = 0; i < herbBuf.length; i++) {
      if (herbBuf[i].id === h.id) continue;
      const delta = herbHash.wrappedDelta(h.pos, herbBuf[i].pos);
      if (herbBuf[i].lineageId === h.lineageId) {
        sameX += delta.x;
        sameY += delta.y;
        sameCount++;
      } else {
        otherX += delta.x;
        otherY += delta.y;
        otherCount++;
      }
    }
    if (sameCount > 0) {
      sameX /= sameCount;
      sameY /= sameCount;
      fx += sameX * 0.25;
      fy += sameY * 0.25;
    }
    if (otherCount > 0) {
      otherX /= otherCount;
      otherY /= otherCount;
      fx += otherX * 0.04;
      fy += otherY * 0.04;
    }
  }
```

2. After the cohesion block, add home drift (before the wander noise section):

```typescript
  // Home drift: gentle pull toward birthplace when far away
  const homeDx = h.birthPos.x - h.pos.x;
  const homeDy = h.birthPos.y - h.pos.y;
  const homeDist = Math.sqrt(homeDx * homeDx + homeDy * homeDy);
  if (homeDist > 400) {
    const homeStr = 5 * Math.min((homeDist - 400) / 400, 1);
    fx += (homeDx / homeDist) * homeStr;
    fy += (homeDy / homeDist) * homeStr;
  }
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p9): lineage-aware cohesion + home drift for territorial herds"`

---

### Task 4: Satiated Predator Patrol Near Herds

When predators are satiated, instead of random wandering, steer them toward the nearest cluster of herbivores at a distance — patrolling rather than hunting.

**Files:**
- Modify: `src/sim/agents.ts:487-593` (steerPredator — add patrol behavior after satiation check)

**Changes:**

1. In `steerPredator`, after the `if (!isSatiated) { ... }` block for herbivore targeting (around line 540), add an else clause for satiated patrol:

```typescript
  if (!isSatiated) {
    // ... existing hunting code ...
  } else {
    // Satiated: patrol near nearest herbivore cluster at safe distance
    const patrolBuf: Herbivore[] = [];
    herbHash.query(p.pos, vision * 1.5, patrolBuf);
    if (patrolBuf.length > 0) {
      // Find center of nearest herbivore group
      let cx = 0, cy = 0;
      for (let i = 0; i < patrolBuf.length; i++) {
        const delta = herbHash.wrappedDelta(p.pos, patrolBuf[i].pos);
        cx += delta.x;
        cy += delta.y;
      }
      cx /= patrolBuf.length;
      cy /= patrolBuf.length;
      const d = Math.sqrt(cx * cx + cy * cy);
      if (d > 1) {
        // Orbit at ~80% of vision range
        const idealDist = vision * 0.8;
        const orbitStr = d < idealDist ? -8 : 12;
        fx += (cx / d) * orbitStr;
        fy += (cy / d) * orbitStr;
        // Add perpendicular drift for orbiting motion
        fx += (-cy / d) * 6;
        fy += (cx / d) * 6;
      }
    }
  }
```

Note: The existing code structure has `if (!isSatiated) {` wrapping the hunting block. The `else` clause adds the new patrol behavior.

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p9): satiated predators patrol near herds instead of random wandering"`

---

### Task 5: Oscillation Tuning — Density Cap and Predator Starvation

Lower soft cap ratio for sharper peaks. Add predator starvation acceleration for faster crashes.

**Files:**
- Modify: `src/sim/agents.ts:24-30` (densityReproChance — soft cap 0.7 -> 0.5)
- Modify: `src/sim/agents.ts:883-889` (predator metabolism — starvation acceleration)

**Changes:**

1. In `densityReproChance` (line 25), change soft cap ratio:

```typescript
  const softCap = hardCap * 0.5;
```

2. In predator metabolism section (around line 889), after the existing energy drain line `p.energy -= (baseMetaP + speedCostP + sizeCostP) * dt;`, add starvation acceleration:

```typescript
    // Starvation acceleration: metabolism +50% when energy is low
    if (p.energy < 30) {
      p.energy -= baseMetaP * 0.5 * dt;
    }
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat(p9): sharper density cap + predator starvation acceleration for boom-bust cycles"`

---

### Task 6: Event Pacing — Faster Cooldowns

Reduce event cooldown from 30-90s to 20-60s for more frequent drama.

**Files:**
- Modify: `src/sim/events.ts:11` (cooldown range)

**Changes:**

1. Change line 11 from:

```typescript
      state.eventCooldown = 30 + rng.next() * 60;
```

to:

```typescript
      state.eventCooldown = 20 + rng.next() * 40;
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/events.ts && git commit -m "feat(p9): reduce event cooldown to 20-60s for more frequent drama"`

---

### Task 7: Enhance Population Graph

The existing graph at `src/ui/graph.ts` works but is small (60px tall) with no value labels. Make it taller and add current population count labels at the right edge of each line.

**Files:**
- Modify: `src/ui/graph.ts:4` (GRAPH_HEIGHT)
- Modify: `src/ui/graph.ts:100-146` (draw method — add labels)

**Changes:**

1. Change line 4 from `const GRAPH_HEIGHT = 60;` to:

```typescript
const GRAPH_HEIGHT = 100;
```

2. In the `draw()` method, after the line-drawing loop (after line 146), add current value labels:

```typescript
    // Current value labels at right edge
    if (this.data.length > 0) {
      const latest = this.data[this.data.length - 1];
      const labels: { value: number; color: string; label: string }[] = [
        { value: latest.herbivores, color: '#55ddaa', label: `H: ${latest.herbivores}` },
        { value: latest.predators, color: '#cc5544', label: `P: ${latest.predators}` },
        { value: latest.scavengers, color: '#ccaa44', label: `S: ${latest.scavengers}` },
      ];
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      for (const lb of labels) {
        const y = h - (lb.value / max) * (h - 4) - 2;
        const clampedY = Math.max(10, Math.min(h - 4, y));
        ctx.fillStyle = lb.color;
        ctx.fillText(lb.label, w - 6, clampedY - 4);
      }
      ctx.textAlign = 'left';
    }
```

3. Increase line width from 1.5 to 2 for better visibility (line 137):

```typescript
      ctx.lineWidth = 2;
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/ui/graph.ts && git commit -m "feat(p9): larger population graph with current value labels"`

---

### Task 8: Final Build Verification

**Steps:**

1. `npx tsc --noEmit` — 0 errors
2. `npx vite build` — success
3. Visual check:
   - Creatures no longer clump at edges/corners
   - Herbivores form 2-4 distinct lineage clusters
   - Predators orbit near herds when satiated
   - Population graph shows clear oscillation waves
   - Boom-bust cycles complete in ~3-4 minutes
   - Events (drought, bloom, disease) trigger every 20-60 seconds
   - Graph labels show current population counts
