# Phase 6: Legacy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add lineage tracking, dominant lineage visualization, and generation counter to create evolutionary storytelling.

**Architecture:** Add `lineageId` and `generation` to the Agent interface. First-spawned creatures are their own lineage founders. Offspring inherit lineageId and increment generation. Renderer hue-shifts species base colors by lineageId hash. Dominant lineages (5+ members) get brighter glow. Stats track max generation. Feed announces lineage milestones.

**Tech Stack:** TypeScript, PixiJS v8, Vite

---

### Task 1: Lineage Fields on Agent & Creation Functions

Add `lineageId` and `generation` fields to Agent interface and all creation functions.

**Files:**
- Modify: `src/sim/types.ts` (Agent interface)
- Modify: `src/sim/agents.ts` (createHerbivore, createPredator, createScavenger)

**Changes:**

1. In `src/sim/types.ts`, add to `Agent` interface after `alive: boolean;` (line 39):
```typescript
  lineageId: number;
  generation: number;
```

2. In `src/sim/agents.ts`, update `createHerbivore` return object to include:
```typescript
    lineageId: id, // founder of own lineage
    generation: 0,
```

Update `createPredator` return object:
```typescript
    lineageId: id,
    generation: 0,
```

Update `createScavenger` return object:
```typescript
    lineageId: id,
    generation: 0,
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/agents.ts && git commit -m "feat: add lineageId and generation fields to Agent interface"`

---

### Task 2: Lineage Inheritance in Reproduction

When creatures reproduce, offspring inherit the parent's lineageId and increment generation.

**Files:**
- Modify: `src/sim/agents.ts` (reproduction sections in all three update functions)

**Changes:**

1. In `updateHerbivores`, after creating the child (line ~566-573), add lineage inheritance:
```typescript
      child.lineageId = h.lineageId;
      child.generation = h.generation + 1;
```

2. In `updatePredators`, after creating the child:
```typescript
      child.lineageId = p.lineageId;
      child.generation = p.generation + 1;
```

3. In `updateScavengers`, after creating the child:
```typescript
      child.lineageId = s.lineageId;
      child.generation = s.generation + 1;
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat: inherit lineageId and increment generation on reproduction"`

---

### Task 3: Lineage Color Hashing in Renderer

Hue-shift species base colors by lineageId hash. Herbivore lineages range blue-green to yellow-green. Predator lineages orange-red to pink-red. Scavenger lineages amber to gold.

**Files:**
- Modify: `src/render/renderer.ts` (add hue-shift helper, apply to creature rendering)

**Changes:**

1. Add a lineage color helper after `mixTintGrey`:
```typescript
function hueShiftByLineage(baseTint: number, lineageId: number, range: number): number {
  // Hash lineageId to a value in [-range, +range] degrees
  const hash = ((lineageId * 2654435761) >>> 0) / 0xffffffff; // 0-1
  const shift = (hash - 0.5) * 2 * range; // -range to +range degrees

  // Convert tint to HSL, shift hue, convert back
  const r = ((baseTint >> 16) & 0xff) / 255;
  const g = ((baseTint >> 8) & 0xff) / 255;
  const b = (baseTint & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return baseTint; // achromatic

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  // Apply shift
  h = ((h + shift / 360) % 1 + 1) % 1;

  // HSL to RGB
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
```

2. In the herbivore rendering loop, replace `sprite.tint = 0x55ddaa;` with:
```typescript
      const lineageTint = hueShiftByLineage(0x55ddaa, h.lineageId, 30);
      sprite.tint = lineageTint;
```

And update the elder grey-mix to use lineageTint:
```typescript
      if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTint, life.tintMix);
```

Also update the glow tint:
```typescript
      glowH.tint = lineageTint;
```

And selection ring tint:
```typescript
        ring.tint = lineageTint;
```

3. Same pattern for predators (base 0xee6655, range 30):
```typescript
      const lineageTint = hueShiftByLineage(0xee6655, p.lineageId, 30);
      sprite.tint = lineageTint;
      if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTint, life.tintMix);
      ...
      glowP.tint = lineageTint;
      ...
      ring.tint = lineageTint;
```

4. Same for scavengers (base 0xccaa44, range 25):
```typescript
      const lineageTint = hueShiftByLineage(0xccaa44, s.lineageId, 25);
      sprite.tint = lineageTint;
      if (life.tintMix > 0) sprite.tint = mixTintGrey(lineageTint, life.tintMix);
      ...
      glowS.tint = lineageTint;
      ...
      ring.tint = lineageTint;
```

**Verify:** `npx tsc --noEmit`. Run dev server. Different lineages should show subtly different hues within their species color range.

**Commit:** `git add src/render/renderer.ts && git commit -m "feat: add lineage-based hue shifting for creature colors"`

---

### Task 4: Dominant Lineage Glow

Lineages with 5+ living members get brighter glow (alpha 0.5). 10+ even brighter (0.7).

**Files:**
- Modify: `src/sim/simulation.ts` (compute lineage population counts)
- Modify: `src/sim/types.ts` (add lineageCounts to SimState)
- Modify: `src/render/renderer.ts` (use lineage counts for glow intensity)

**Changes:**

1. In `src/sim/types.ts`, add to `SimState` after `feedEvents: FeedEvent[];`:
```typescript
  lineageCounts: Map<number, number>;
```

2. In `src/sim/simulation.ts`, in constructor and reset state init, add:
```typescript
      lineageCounts: new Map(),
```

3. In `computeStats()`, compute lineage counts:
```typescript
    // Lineage population counts
    state.lineageCounts.clear();
    const allCreatures = [...state.herbivores, ...state.predators, ...state.scavengers];
    for (let i = 0; i < allCreatures.length; i++) {
      const lid = allCreatures[i].lineageId;
      state.lineageCounts.set(lid, (state.lineageCounts.get(lid) || 0) + 1);
    }
```

4. In `src/render/renderer.ts`, modify the glow alpha calculation for each species. For herbivores:
```typescript
      const lineageSize = state.lineageCounts?.get(h.lineageId) || 1;
      const dominanceGlow = lineageSize >= 10 ? 0.7 : lineageSize >= 5 ? 0.5 : 0.3;
      glowH.alpha = (dominanceGlow + 0.1 * Math.sin(time * 2 + h.id)) * life.glowAlphaMul;
```

For predators:
```typescript
      const lineageSize = state.lineageCounts?.get(p.lineageId) || 1;
      const dominanceGlow = lineageSize >= 10 ? 0.7 : lineageSize >= 5 ? 0.5 : 0.3;
      glowP.alpha = (dominanceGlow + 0.1 * Math.sin(time * 2 + p.id)) * life.glowAlphaMul;
```

For scavengers:
```typescript
      const lineageSize = state.lineageCounts?.get(s.lineageId) || 1;
      const dominanceGlow = lineageSize >= 10 ? 0.7 : lineageSize >= 5 ? 0.5 : 0.3;
      glowS.alpha = (dominanceGlow + 0.1 * Math.sin(time * 2 + s.id)) * life.glowAlphaMul;
```

**Verify:** `npx tsc --noEmit`. Run dev server. Dominant lineages (5+ members) should have visibly brighter glows.

**Commit:** `git add src/sim/types.ts src/sim/simulation.ts src/render/renderer.ts && git commit -m "feat: add dominant lineage glow based on population size"`

---

### Task 5: Generation Counter in Stats

Show max generation in stats panel. Add lineage info to inspector.

**Files:**
- Modify: `src/sim/types.ts` (SimStats)
- Modify: `src/sim/simulation.ts` (compute max generation)
- Modify: `src/ui/overlay.ts` (display in stats)
- Modify: `src/ui/inspector.ts` (show lineage + generation)

**Changes:**

1. In `src/sim/types.ts`, add to `SimStats`:
```typescript
  maxGeneration: number;
```

2. In `src/sim/simulation.ts`, in `emptyStats()`:
```typescript
  maxGeneration: 0,
```

In `computeStats()`, compute max generation (can share the allCreatures array from lineage counting):
```typescript
    let maxGen = 0;
    for (let i = 0; i < allCreatures.length; i++) {
      if (allCreatures[i].generation > maxGen) {
        maxGen = allCreatures[i].generation;
      }
    }
    stats.maxGeneration = maxGen;
```

3. In `src/ui/overlay.ts`, in `updateStats()`, add after scavenger count:
```typescript
      <div><span class="label">Max Gen:</span> <span class="value">${stats.maxGeneration}</span></div>
```

4. In `src/ui/inspector.ts`, if the inspector shows creature details, add lineage and generation info to the card display. Find where traits are displayed and add:
```typescript
      <div class="inspector-trait"><span>Lineage</span><span>#${creature.lineageId}</span></div>
      <div class="inspector-trait"><span>Generation</span><span>${creature.generation}</span></div>
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/simulation.ts src/ui/overlay.ts src/ui/inspector.ts && git commit -m "feat: add generation counter to stats and inspector"`

---

### Task 6: Lineage Feed Events

Announce "Line #N dominant (X members)" at threshold crossings. "Line #N ended" on last death.

**Files:**
- Modify: `src/sim/simulation.ts` (detect lineage milestones in detectFeedEvents)

**Changes:**

1. Add fields to Simulation class:
```typescript
  private prevLineageCounts: Map<number, number> = new Map();
```

Reset in `reset()`:
```typescript
    this.prevLineageCounts.clear();
```

2. In `detectFeedEvents()`, add lineage event detection:
```typescript
    // Lineage milestones
    for (const [lid, count] of state.lineageCounts) {
      const prev = this.prevLineageCounts.get(lid) || 0;
      if (count >= 5 && prev < 5) {
        feed.push({ time: t, text: `Line #${lid} dominant (${count})`, color: '#aabbcc' });
      }
      if (count >= 10 && prev < 10) {
        feed.push({ time: t, text: `Line #${lid} thriving (${count})`, color: '#ccddee' });
      }
    }
    // Lineage endings
    for (const [lid, prev] of this.prevLineageCounts) {
      if (prev > 0 && (!state.lineageCounts.has(lid) || state.lineageCounts.get(lid) === 0)) {
        if (prev >= 3) { // Only announce if lineage was notable
          feed.push({ time: t, text: `Line #${lid} ended`, color: '#667788' });
        }
      }
    }
    this.prevLineageCounts = new Map(state.lineageCounts);
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/simulation.ts && git commit -m "feat: add lineage milestone and extinction feed events"`

---

### Task 7: Final Build Verification

**Steps:**

1. `npx tsc --noEmit` — 0 errors
2. `npx vite build` — success
3. Visual check:
   - Different lineages show different hues within species
   - Dominant lineages have brighter glows
   - Max Gen counter increases over time
   - Inspector shows lineage and generation
   - Feed announces lineage milestones and endings
   - All Phase 5 features still work (day/night, weather)
