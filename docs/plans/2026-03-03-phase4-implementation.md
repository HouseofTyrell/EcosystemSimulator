# Phase 4: Balance + Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix overlay fade bug, add adaptive population caps, slow growth defaults, and creature lifecycle stages (baby/adult/elder).

**Architecture:** Four independent tasks. Task 1 is a UI bugfix. Task 2 adds population caps to sim config and reproduction gating. Task 3 changes numeric defaults. Task 4 adds lifecycle-aware speed/scale/tint modifiers to agents and renderer. No new files needed — all modifications to existing code.

**Tech Stack:** TypeScript, PixiJS v8, Vite

---

### Task 1: Fix Stats Overlay Fade Bug

The overlay fades away after 5 seconds because `resetFadeTimer()` sets a timeout that adds the `hidden` CSS class. Since users now have per-element toggles in settings, the auto-fade is unnecessary and actively harmful.

**Files:**
- Modify: `src/ui/overlay.ts:25,297,301-319`

**Changes:**

1. Remove the `fadeTimeout` field (line 25):
```typescript
// DELETE this line:
private fadeTimeout: ReturnType<typeof setTimeout> | null = null;
```

2. Simplify `showOverlay()` (line 307-310) to only remove the hidden class — no more timer reset:
```typescript
private showOverlay(): void {
  this.overlay.classList.remove('hidden');
}
```

3. Remove the entire `resetFadeTimer()` method (lines 312-319):
```typescript
// DELETE the entire resetFadeTimer method
```

4. Remove the entire `setupMouseFade()` method (lines 301-305) — it's unused but clean it up:
```typescript
// DELETE the entire setupMouseFade method
```

**Verify:** `npx tsc --noEmit`. Run `npx vite dev`. Stats should never fade away. Settings panel stays visible. All keyboard shortcuts still work.

**Commit:** `git add src/ui/overlay.ts && git commit -m "fix: remove overlay auto-fade so stats stay visible"`

---

### Task 2: Adaptive Population Caps

Add `maxHerbivores`, `maxPredators`, `maxScavengers` fields to SimConfig, computed from screen area. Gate reproduction on population caps.

**Files:**
- Modify: `src/sim/types.ts:75-121,181-220` (add fields to SimConfig and DEFAULT_CONFIG)
- Modify: `src/sim/agents.ts:533-536,650-653,764` (gate reproduction on caps)
- Modify: `src/main.ts` (compute caps on init and resize)

**Changes:**

1. In `src/sim/types.ts`, add to `SimConfig` interface after `wrapWorld: boolean;` (line 120):
```typescript
  // Population caps (adaptive)
  maxHerbivores: number;
  maxPredators: number;
  maxScavengers: number;
```

Add to `DEFAULT_CONFIG` after `wrapWorld: false,` (line 219):
```typescript
  maxHerbivores: 60,
  maxPredators: 20,
  maxScavengers: 15,
```

2. In `src/sim/agents.ts`, add population cap checks to reproduction. In the herbivore reproduction block (around line 533), change:
```typescript
    if (
      h.energy > config.herbivoreReproductionEnergy &&
      h.reproductionCooldown <= 0
    ) {
```
to:
```typescript
    if (
      h.energy > config.herbivoreReproductionEnergy &&
      h.reproductionCooldown <= 0 &&
      state.herbivores.length + newborns.length < config.maxHerbivores
    ) {
```

Do the same for predators (around line 650) — the `updatePredators` function has a similar `newborns` array:
```typescript
    if (
      p.energy > config.predatorReproductionEnergy &&
      p.reproductionCooldown <= 0 &&
      state.predators.length + newborns.length < config.maxPredators
    ) {
```

And scavengers (around line 764) — check the `updateScavengers` function for its newborns array name:
```typescript
    if (s.energy > config.scavengerReproductionEnergy && s.reproductionCooldown <= 0 &&
        state.scavengers.length + newborns.length < config.maxScavengers) {
```

3. In `src/main.ts`, add a helper method to the App class:
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

Call `this.updatePopCaps()` in `start()` after `this.sim.reset(this.seed)` (around line 36).

Call `this.updatePopCaps()` in the resize handler (after setting worldWidth/worldHeight).

Call `this.updatePopCaps()` in `reset()` after `this.sim.reset(seed)`.

**Verify:** `npx tsc --noEmit`. Run dev server. Populations should plateau instead of growing unbounded. On a 1920x1080 screen, expect ~60 herb max, ~20 pred max, ~15 scav max.

**Commit:** `git add src/sim/types.ts src/sim/agents.ts src/main.ts && git commit -m "feat: add adaptive population caps based on screen size"`

---

### Task 3: Slower Growth Defaults

Increase reproduction thresholds and cooldowns, decrease plant growth rate. Update slider defaults to match.

**Files:**
- Modify: `src/sim/types.ts:181-220` (DEFAULT_CONFIG values)
- Modify: `src/ui/overlay.ts:134-185` (slider default values)

**Changes:**

1. In `src/sim/types.ts:DEFAULT_CONFIG`, change these values:
```
plantGrowthRate: 0.3 -> 0.20
herbivoreReproductionEnergy: 80 -> 105
herbivoreReproductionCooldownTime: 5 -> 12
predatorReproductionEnergy: 100 -> 130
predatorReproductionCooldownTime: 8 -> 15
scavengerReproductionEnergy: 60 -> 80
scavengerReproductionCooldownTime: 6 -> 10
```

2. In `src/ui/overlay.ts`, update slider `value` attributes and displayed `.val` text to match new defaults:

Plant Growth slider (line ~146): `value="30"` -> `value="20"`, val text `0.30` -> `0.20`

Herb Repro Energy slider (line ~158): `value="80"` -> `value="105"`, val text `80` -> `105`

Pred Repro Energy slider (line ~163): `value="100"` -> `value="130"`, val text `100` -> `130`

Scav Repro Energy slider (line ~168): `value="60"` -> `value="80"`, val text `60` -> `80`

**Verify:** `npx tsc --noEmit`. Run dev server. Growth should be noticeably slower — more time to observe individual herds forming before the world fills up.

**Commit:** `git add src/sim/types.ts src/ui/overlay.ts && git commit -m "feat: slower growth defaults for better pacing"`

---

### Task 4: Creature Lifecycles

Add baby/adult/elder lifecycle stages with visual and gameplay effects. No new data — uses existing `age` and `maxAge` fields.

**Files:**
- Modify: `src/sim/agents.ts:473-539,582-656,697-766` (speed modifiers, reproduction gating by age)
- Modify: `src/render/renderer.ts:294-392` (scale, tint, glow modifiers by age)

**Changes:**

#### A. Gameplay changes in `src/sim/agents.ts`

Define lifecycle helper at top of file (after imports):
```typescript
function getLifeStage(age: number, maxAge: number): 'baby' | 'adult' | 'elder' {
  const ratio = age / maxAge;
  if (ratio < 0.15) return 'baby';
  if (ratio < 0.75) return 'adult';
  return 'elder';
}

function getSpeedMultiplier(stage: 'baby' | 'adult' | 'elder'): number {
  if (stage === 'baby') return 0.8;
  if (stage === 'elder') return 0.85;
  return 1.0;
}
```

In `updateHerbivores` (around line 473), after `h.age += dt;`, add:
```typescript
    const stage = getLifeStage(h.age, h.maxAge);
```

Where the herbivore velocity is applied to position (the movement section after steering, where `h.pos.x += h.vel.x * dt` appears), multiply velocity by the speed multiplier. Find the lines where velocity is applied and wrap them:
```typescript
    const spdMul = getSpeedMultiplier(stage);
    h.pos.x += h.vel.x * dt * spdMul;
    h.pos.y += h.vel.y * dt * spdMul;
```

In the reproduction check (line ~535), add age gating — babies can't reproduce, elders pay 2x cost:
```typescript
    if (
      h.energy > config.herbivoreReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      h.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.herbivores.length + newborns.length < config.maxHerbivores
    ) {
```

Apply the same pattern to `updatePredators` and `updateScavengers`:
- Add `const stage = getLifeStage(...)` after age increment
- Multiply velocity by speed multiplier in the movement section
- Add `stage !== 'baby'` and elder 2x cost to reproduction checks

#### B. Visual changes in `src/render/renderer.ts`

Define a lifecycle visual helper near the top of the file (after the `lerpColor` function):
```typescript
function getLifeVisuals(age: number, maxAge: number): { scaleMul: number; tintMix: number; glowAlphaMul: number } {
  const ratio = age / maxAge;
  if (ratio < 0.15) {
    // Baby: small, bright
    return { scaleMul: 0.6, tintMix: 0, glowAlphaMul: 1.2 };
  }
  if (ratio < 0.75) {
    // Adult: normal
    return { scaleMul: 1.0, tintMix: 0, glowAlphaMul: 1.0 };
  }
  // Elder: slightly smaller, grayed out, dim glow
  const elderProgress = (ratio - 0.75) / 0.25; // 0 to 1 within elder phase
  return { scaleMul: 0.9, tintMix: elderProgress * 0.4, glowAlphaMul: 1.0 - elderProgress * 0.5 };
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
```

In the herbivore rendering loop (lines 294-334), after computing `baseScale`:
```typescript
      const life = getLifeVisuals(h.age, h.maxAge);
      const baseScale = h.traits.size * scaleX * 0.12 * life.scaleMul;
```
(Replace the existing `baseScale` line — just multiply by `life.scaleMul`.)

After `sprite.tint = 0x55ddaa;`, add:
```typescript
      if (life.tintMix > 0) sprite.tint = mixTintGrey(0x55ddaa, life.tintMix);
```

For the glow ring alpha, multiply by `life.glowAlphaMul`:
```typescript
      glowH.alpha = (0.3 + 0.1 * Math.sin(time * 2 + h.id)) * life.glowAlphaMul;
```

Apply the same pattern to predator rendering (tint `0xee6655`) and scavenger rendering (tint `0xccaa44`):
- Add `const life = getLifeVisuals(...)`
- Multiply baseScale by `life.scaleMul`
- Apply `mixTintGrey` if `life.tintMix > 0`
- Multiply glow alpha by `life.glowAlphaMul`

**Verify:** `npx tsc --noEmit`. Run dev server. Newly spawned creatures should appear small (60% size). As they age, they reach full size. Old creatures should gradually gray out and have dimmer glow rings. Babies should not reproduce. Check all 3 species.

**Commit:** `git add src/sim/agents.ts src/render/renderer.ts && git commit -m "feat: add creature lifecycles with baby/adult/elder visual and gameplay stages"`

---

### Task 5: Final Build Verification

**Steps:**

1. `npx tsc --noEmit` — 0 errors
2. `npx vite build` — success
3. Visual check:
   - Stats never fade away
   - Populations cap at reasonable numbers (not hundreds)
   - Growth is slow enough to watch herds form
   - New creatures start small and grow
   - Old creatures fade to grey
   - Sliders reflect new default values
