# Phase 8: Tuning & Thriving — Design Document

## Goal

Transform the ecosystem simulator from a small, extinction-prone system into a large-scale Lotka-Volterra oscillator supporting ~1000 creatures at 60 FPS. Populations should boom and crash in classic predator-prey waves, with extinct species auto-reintroduced using adaptive trait memory.

## Architecture

Five interconnected changes to existing systems — no new modules. Density-dependent reproduction creates logistic growth curves. Predator satiation creates the delayed feedback loop essential for oscillation. Adaptive reintroduction ensures extinct species return viable. Plant growth scales to feed larger populations. Rendering LOD maintains 60 FPS at scale.

## Sub-phases

### 8A: Population Caps & Density-Dependent Reproduction

**Raise hard caps:**
- `maxHerbivores`: 60 → 800 (baseline, scaled by screen area)
- `maxPredators`: 20 → 250
- `maxScavengers`: 15 → 150

Hard caps are safety limits. Real population control comes from density feedback.

**Density-dependent reproduction:**

Add a reproduction probability check in each species' reproduction logic:

```
softCap = hardCap * 0.7
reproductionChance = 1 - (currentPop / softCap)²
```

When `currentPop < softCap * 0.5`: reproduction is nearly free (>75% chance).
When `currentPop ≈ softCap`: reproduction drops to ~0%.
When `currentPop > softCap`: reproduction is effectively impossible.

This creates the logistic growth curve (S-shape) that is the mathematical foundation of Lotka-Volterra oscillations.

**Files:** `src/sim/types.ts` (cap values), `src/sim/agents.ts` (reproduction checks), `src/main.ts` (updatePopCaps)

### 8B: Predator Satiation & Hunting Dynamics

**Satiation threshold:** Predators stop actively hunting when energy > 80% of `predatorReproductionEnergy`. They wander and burn energy but won't chase or attack. This is the critical mechanism that lets herbivore populations recover after a crash — without it, efficient predators drive prey to extinction every time.

**Implementation:** In `steerPredator`, when satiated, skip target acquisition and use random wandering instead. The predator still pays movement costs, so satiation is temporary.

**Files:** `src/sim/agents.ts` (steerPredator, updatePredators)

### 8C: Adaptive Reintroduction

**Trait memory system:** Maintain rolling arrays of the last 50 successful reproduction events per species. Each entry stores the parent's traits at time of reproduction. Stored on `SimState` so it persists across the simulation lifetime but resets on seed reset.

**On extinction, reintroduce with:**
- **Count:** 15 herbivores / 6 predators / 8 scavengers (up from 5/2/3)
- **Traits:** Average of last 50 reproduction snapshots (pre-adapted to current environment)
- **Energy:** Equal to reproduction threshold (can reproduce immediately)
- **10-second establishment period:** Disease events skip species with < 10 seconds since reintroduction

**If no trait memory exists** (first extinction before any reproduction): use default trait values but with the higher spawn count and energy.

**Files:** `src/sim/types.ts` (trait memory arrays on SimState), `src/sim/simulation.ts` (reintroduction logic), `src/sim/agents.ts` (record trait snapshots on reproduction)

### 8D: Plant & Energy Economy Rebalance

**Plant growth:**
- `plantGrowthRate`: 0.20 → 0.35 (75% increase to support larger herbivore populations)
- The logistic growth formula `r * p * (1 - p/K)` naturally caps density — faster growth just means faster recovery after grazing

**Reproduction thresholds:**
- `herbivoreReproductionEnergy`: 105 → 80
- `predatorReproductionEnergy`: 130 → 100
- `scavengerReproductionEnergy`: 80 → 60

**Disease tuning:**
- Initial infections per outbreak: 2-3 → 1-2
- Disease damage: 3/sec → 2/sec
- At large populations, contagion spread provides the lethality naturally
- At small populations, a single disease event won't be catastrophic

**Files:** `src/sim/types.ts` (default config values), `src/sim/events.ts` (disease parameters)

### 8E: Rendering LOD for 60 FPS at Scale

**Distance-based detail levels:**
- When a creature's screen size < 4px (zoomed out): skip glow rings, shadows, stamina tint. Render base sprite only.
- Calculate using camera zoom level, not per-creature (one check per frame, not per creature).

**Particle budget scaling:**
- Cap ambient particles (mist/pollen/firefly) at 40 total regardless of anything.
- At > 300 total creatures: skip birth/death particle bursts for non-inspected creatures.

**Viewport culling:**
- Skip rendering for creatures > 100px outside the visible camera viewport.
- Use creature position + camera transform to determine visibility.
- The spatial hash already tracks positions — reuse it for efficient bounds checking.

**Pool pre-allocation:**
- Pre-allocate herbivore/predator/scavenger/glow/shadow sprite pools for 1000 sprites at init.
- Avoids runtime allocation stalls during population booms.

**Files:** `src/render/renderer.ts` (LOD logic, culling, pool sizing, particle caps)

## Success Criteria

1. Herbivore populations regularly reach 400-600 during boom phases
2. Predator populations follow with a visible delay, reaching 80-150
3. Populations oscillate with a period of roughly 2-4 minutes
4. Species extinction is rare (< once per 10 minutes) but not impossible
5. When extinction occurs, reintroduced species establish successfully > 80% of the time
6. 60 FPS maintained at 1000 total creatures on a 1920x1080 screen
7. No simulation parameter changes break the existing settings panel sliders

## Non-Goals

- New creature types or behaviors
- New visual effects
- New UI features
- Reworking the energy economy from scratch
