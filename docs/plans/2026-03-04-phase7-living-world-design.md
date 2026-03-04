# Phase 7: "Living World" Design

**Goal:** Transform the ecosystem simulator from a technical prototype into an immersive, interactive nature documentary. Covers visual atmosphere, simulation depth, camera interaction, ecological memory, and observability.

**Tech Stack:** TypeScript, PixiJS v8, Vite, Web Audio API

**Dependencies:** Builds on Phases 1-6 (terrain, creatures, weather, day/night, lineage tracking, lifecycle stages).

---

## 7A: Visual Foundation

### Bloom Filter on Glows
Apply `BlurFilter` to `glowContainer` (strength 4-6). At night, boost strength to 8 and increase glow alpha. Makes overlapping creature clusters glow organically. 3 lines in renderer constructor.

### Additive Blend Modes
- `glowContainer.blendMode = 'add'` — overlapping glows brighten each other instead of stacking alpha
- `nightOverlay` — use multiply blend so darkness preserves glow colors while dimming terrain
- `particleContainer.blendMode = 'add'` — birth/death particles look radiant

### RenderTexture Terrain Cache
Render all terrain cells into a `RenderTexture` once. Display as a single `Sprite`. Re-render only when:
- Season changes by > 0.01 (~every 0.45s)
- Drought/bloom event starts or ends
- Simulation resets
- Soil health changes (Phase 7D)

Shore shimmer and water animation move to a lightweight overlay updating every 3rd frame. Eliminates the heaviest per-frame cost (~3600 cell draws/frame → 1 sprite blit).

### Color Palette Boost
**Seasonal backgrounds** (widen ~50%):
- Spring: `0x183318` (was `0x102212`)
- Summer: `0x332d12` (was `0x221e0e`)
- Autumn: `0x331a10` (was `0x22120c`)
- Winter: `0x101836` (was `0x0c1024`)

**Creature saturation** (+15%):
- Herbivore base: `0x5dd880` (was `0x6dbb7a`)
- Predator base: `0xe87744` (was `0xcc8855`)
- Scavenger base: `0xd4a840` (was `0xb89955`)

**Plant variety:** Tint shifts by terrain proximity — blue-green near water, yellow-green near mountains, deep emerald in fertile zones.

### Dawn/Dusk Enhancement
- Increase warm overlay alpha: 0.08 → 0.15 max
- Horizon gradient: 3-4 horizontal bands, warmest at bottom
- Shadow offset scales with sun angle: 2px (midday) → 5px (dawn/dusk peak)
- Creature glow tints shift warmer during golden hour (+10 red, -5 blue)

---

## 7B: Simulation Depth

### Stamina/Sprint System
Add `stamina: number` (0-100) to Agent. Sprinting (>80% max speed) drains stamina at 15/s. Walking (<40% max speed) recovers at 8/s. When stamina hits 0, creature enters `exhausted` state — max speed drops to 60% until stamina recovers to 30%.

Creates dramatic chase sequences where outcome depends on endurance, not just raw speed.

### Predator Target Scoring
Replace "chase nearest herbivore" with pursuit viability scoring:
```
catchScore = (predSpeed - preySpeed * 0.8) * sizeMismatch / (distance + 10)
```
Predators target highest-scoring prey. Creates arms-race dynamics: middling-speed herbivores get selected against, pushing toward "fast escaper" or "big/tough" phenotypes.

### Quadratic Speed-Energy Cost
Replace linear speed cost with super-linear:
```
speedCost = traits.speed * relativeSpeed^2 * 0.008
baseMetabolism += traits.speed * sqrt(traits.speed) * 0.001
```
Creates a "Goldilocks zone" for speed — fast enough to escape sometimes, slow enough not to starve. Prevents runaway speed convergence.

### Attack Success Probability
Kill chance based on relative size and speed:
```
killChance = clamp(0.1, 0.95, 0.5 + speedAdvantage * 0.3 + sizeAdvantage * 0.2)
```
Failed attacks cost 30% of normal attack energy. Creates selective pressure for herbivore size as defense, and punishes predators that attack "wrong" prey.

### Threat Persistence + Alarm Propagation
**Threat persistence:** Add `lastThreatPos: Vec2 | null` and `threatTimer: number` to Agent. When predator detected, record position and set 5s timer. Continue fleeing from remembered position even after predator leaves vision.

**Alarm calls:** When a herbivore enters `fleeing` state, nearby herbivores within 50px also enter fleeing, steering away from the same threat position. Chain once to prevent infinite propagation. Creates stampede behavior.

### Balance Fixes
1. **Predator turnRate as trait:** Add `turnRate` to `PredatorTraits` and `ScavengerTraits`. Include in mutation. Enables agility vs straight-line-speed evolutionary axis.
2. **Corpse energy scales with size:** `energy = max(10, creature.traits.size * creature.energy * 0.15)` instead of fixed 20/25/15.
3. **Fertile growth bonus reduction:** `r * 2` → `r * 1.4`. Fertile zones affect carrying capacity (`K * 1.5`) rather than just growth rate.

---

## 7C: Camera + Interaction

### Camera System
New `src/camera.ts` module:
```typescript
interface Camera {
  x: number;        // world-space center
  y: number;
  zoom: number;     // 0.5x to 4x
  targetX: number;  // lerp targets
  targetY: number;
  targetZoom: number;
  following: number | null;  // creature ID
}
```

**Controls:**
- Mouse wheel: zoom in/out centered on cursor
- Middle-click drag or right-click drag: pan
- Double-click: zoom to 2x on click point
- `0` key: reset to 1x overview
- `C` key: toggle follow mode on pinned creature

**Rendering:** Apply camera transform to PixiJS stage container:
```typescript
stage.scale.set(camera.zoom);
stage.position.set(screenW/2 - camera.x * camera.zoom, screenH/2 - camera.y * camera.zoom);
```

All mouse interactions inverse-transform through camera before querying world coords. HTML overlays remain in screen space.

**Follow mode:** Smooth lerp (`camera += (target - camera) * 0.05`). If followed creature dies, hold position 2s then smoothly pull back to 1x.

### Hover Tooltips
New `src/ui/tooltip.ts` — single floating `<div>` with `show(x, y, content)` and `hide()`.

On `mousemove` over canvas: spatial query for nearest creature within 20px. Show lightweight tooltip: type, ID, energy bar, behavior, generation. Follows cursor with CSS transition. Vanishes on `mouseleave`. Cursor changes to `pointer` when over a creature.

### Minimap
120x68px canvas in bottom-left (above graph). Renders at low resolution:
- Terrain as colored pixels (sample plant grid directly — 80x45 is close to minimap resolution)
- Creatures as single bright pixels (green/red/yellow)
- White rectangle showing current viewport bounds
- Click to pan to that location

Only renders when camera zoom > 1.2x (hidden at overview zoom).

---

## 7D: Ecological Memory

### Spatial Memory System
Per-creature 8x8 memory grid covering the world:
```typescript
interface SpatialMemory {
  foodQuality: Float32Array;   // 64 cells, decaying average of food found
  dangerLevel: Float32Array;   // 64 cells, decaying average of threats seen
  lastVisited: Float32Array;   // 64 cells, sim-time of last visit
}
```

Each tick: update current cell's memories. During steering: add forces toward high-food cells and away from high-danger cells, weighted by memory staleness. Memory decays over ~30s.

Creates: home ranges, migration when food depletes, predator avoidance zones, individual behavioral differences. 192 bytes per creature (~19KB at 100 creatures).

### Overgrazing / Soil Degradation
Add `soilHealth: Float32Array` parallel to plantGrid. When a cell is grazed below 10% capacity, soil health degrades. Growth rate multiplied by soil health: `effectiveR = baseR * soilHealth[i]`.

Soil recovery rate: ~10x slower than plant growth. Creates visible desertification → migration → recovery cycles. Terrain cache re-renders when soil health changes significantly.

### Contagion Disease
Replace one-shot random disease event with spatial contagion. Add `infected: number` timer to Agent. Infected creatures spread to same-species creatures within proximity, with chance proportional to `1/distance`. Dense populations spread faster.

Creates: density-dependent population regulation, visible disease waves through herds, selective pressure for less-social behavior during outbreaks.

---

## 7E: Visual Atmosphere

### Animated Water
**Caustic patterns:** 2-3 semi-transparent drifting ellipses per water cell (seeded by cell index), animated with offset sine waves at different frequencies (0.8Hz, 1.3Hz, 2.1Hz).

**Shore waves:** Thin bright arc on shore cells that expands outward over 3s cycle, then fades and resets. Simulates gentle surf from aerial view.

**Depth shading:** Deep interior water cells darker (`0x0a1e3a`), shore-adjacent cells lighter (`0x164a7a`).

Rendered on the water overlay layer (separate from terrain cache), updating every 3rd frame.

### Ambient Particles
30-50 persistent drifting specks:
- Near water: light-blue mist particles drifting upward, alpha 0.1-0.2
- Over dense vegetation: yellow-green pollen, drifting with wind
- At night: warm-white firefly particles with pulsing alpha (0-0.3 over 2s), drawn ABOVE night overlay
- During fog: increase count to 80-100, shift to white/grey

Use `ParticleContainer` for GPU-efficient rendering.

### Enhanced Weather
**Rain depth:** Two layers — foreground (current) and background (shorter lines, lower alpha, different angle). Ground splash dots at rain line bottoms.

**Volumetric fog:** Replace flat overlay with 3-4 large glow-texture blobs (scaled 20-40x, tinted `0xccccbb`) that drift slowly. Intensity controls count and alpha.

**Wind plant interaction:** Offset all plant sprite x-positions by `sin(time * 1.5 + cellIndex * 0.3) * intensity * 2` pixels.

---

## 7F: Observability

### Trait Evolution Sparklines
Extend `DataPoint` in `graph.ts` to store average trait values from `SimStats`. Add togglable mini-sparklines (3 per species) below the population graph showing avg speed, size, vision over time. Watch natural selection happen in real-time.

Toggle via `T` key or settings checkbox.

### Inspector Upgrades
1. **Energy sparkline:** 50px-wide mini graph of energy over last 10s (ring buffer per pinned creature)
2. **Death cause:** Display "Starved" / "Killed" / "Old age" / "Disease" instead of just "Dead". Requires `deathCause` field from simulation.
3. **Offspring count:** Track per-creature, display in inspector
4. **Lineage color swatch:** Small colored circle matching rendered creature color
5. **Follow button:** Camera icon that triggers follow-camera mode

### Event Feed Improvements
1. Base fade on sim-time, not wall-clock `Date.now()`
2. Increase `MAX_ENTRIES` to 10
3. Severity levels: critical events (extinction, disease) get left-border highlight and persist longer
4. Expandable history panel (scrollable full event log)
5. Screen-edge flash for critical events (red for extinction, green for bloom)

### Sound Design
Web Audio API with `OscillatorNode` + `GainNode` for generative audio, plus small samples (<500KB total).

**Layers (all togglable):**
1. **Ambient base:** Nature loop, shifts with season, quieter at night
2. **Rain/wind sounds:** Triggered by weather state, fade matches intensity
3. **Creature density hum:** Generative tone correlating with total population
4. **Event stings:** Chime for births, minor note for extinctions, warning for disease
5. **Predator kill:** Brief distant snap

New `src/audio/` module with `AudioManager` class. Master volume slider in settings.

---

## Sub-Phase Dependencies

```
7A (Visual Foundation) ──┬──→ 7C (Camera) ──→ 7F (Observability)
                         │
                         └──→ 7E (Visual Atmosphere)
7B (Sim Depth) ──────────────→ 7D (Ecological Memory)
```

7A and 7B have no dependencies on each other and can run in parallel. 7C requires terrain cache from 7A. 7D requires balance fixes from 7B. 7E requires terrain cache from 7A. 7F requires camera from 7C.

---

## Data Model Changes (types.ts)

**Agent additions:**
- `stamina: number` (0-100)
- `exhausted: boolean`
- `lastThreatPos: Vec2 | null`
- `threatTimer: number`
- `infected: number` (0 = healthy, >0 = infected timer)
- `offspringCount: number`
- `deathCause: 'starved' | 'killed' | 'old_age' | 'disease' | null`
- `memory: SpatialMemory | null`

**PredatorTraits additions:**
- `turnRate: number`

**ScavengerTraits additions:**
- `turnRate: number`

**SimState additions:**
- `soilHealth: Float32Array`

**New interfaces:**
- `Camera` (in camera.ts)
- `SpatialMemory` (in types.ts)
- `AudioManager` (in audio/)
