# Phase 1: Visual Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace plain dot rendering with pooled animated sprites, add lifecycle visual effects (death particles, birth flash), seasonal background tinting, low-energy transparency, and a simulation timer.

**Architecture:** New `SpritePool` utility manages sprite reuse. Textures are generated programmatically from `Graphics` at startup via `renderer.generateTexture()`. The `Renderer` class is rewritten from Graphics-per-frame to pooled Sprites that update position/rotation/scale each frame (GPU-batched). An event system passes birth/death positions from `Simulation` to `Renderer` for particle effects.

**Tech Stack:** PixiJS v8 (Sprite, Graphics, Container, Texture), TypeScript

---

### Task 1: Add Simulation Events for Birth/Death

The simulation currently silently removes dead agents and appends newborns. The renderer needs to know *where* deaths and births happen to show particles. Add an event buffer to `SimState`.

**Files:**
- Modify: `src/sim/types.ts:88-98` (SimState interface)
- Modify: `src/sim/simulation.ts:36-46` (state initialization)
- Modify: `src/sim/simulation.ts:210-228` (reset method)

**Step 1: Add event types and buffer to SimState**

In `src/sim/types.ts`, add after the `SimStats` interface (after line 111):

```typescript
export interface SimEvent {
  type: 'birth' | 'death';
  creatureType: 'herbivore' | 'predator';
  x: number;
  y: number;
}
```

Add `events: SimEvent[];` to the `SimState` interface (after `stats` field).

**Step 2: Initialize events array in Simulation constructor and reset**

In `src/sim/simulation.ts`, add `events: []` to the state object in the constructor (line ~45) and in the `reset` method (line ~226).

**Step 3: Emit events from agent updates**

In `src/sim/agents.ts`:
- Import `SimEvent` from types.
- Change `updateHerbivores` and `updatePredators` to accept a 6th parameter `events: SimEvent[]`.
- When `h.alive = false` (death at line ~299 and predator kill at line ~364), push a death event: `events.push({ type: 'death', creatureType: 'herbivore', x: h.pos.x, y: h.pos.y })`.
- When a newborn is created (line ~322 for herbs, ~419 for preds), push a birth event.

**Step 4: Wire events through simulation.step()**

In `src/sim/simulation.ts`, in the `step()` method:
- Clear `state.events.length = 0` at the start of each step.
- Pass `state.events` to `updateHerbivores()` and `updatePredators()`.

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/sim/types.ts src/sim/agents.ts src/sim/simulation.ts
git commit -m "feat: add birth/death event buffer to simulation state"
```

---

### Task 2: Create SpritePool Utility

A generic pool that acquires sprites from a freelist or creates new ones, and releases them back.

**Files:**
- Create: `src/render/sprite-pool.ts`

**Step 1: Write the SpritePool class**

```typescript
import { Sprite, Texture, Container } from 'pixi.js';

export class SpritePool {
  private pool: Sprite[] = [];
  private texture: Texture;
  private container: Container;

  constructor(texture: Texture, container: Container) {
    this.texture = texture;
    this.container = container;
  }

  acquire(): Sprite {
    let sprite: Sprite;
    if (this.pool.length > 0) {
      sprite = this.pool.pop()!;
    } else {
      sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      this.container.addChild(sprite);
    }
    sprite.visible = true;
    sprite.alpha = 1;
    sprite.scale.set(1);
    sprite.rotation = 0;
    return sprite;
  }

  release(sprite: Sprite): void {
    sprite.visible = false;
    this.pool.push(sprite);
  }

  releaseAll(): void {
    for (let i = this.container.children.length - 1; i >= 0; i--) {
      const child = this.container.children[i] as Sprite;
      if (child.visible) {
        child.visible = false;
        this.pool.push(child);
      }
    }
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/render/sprite-pool.ts
git commit -m "feat: add SpritePool utility for efficient sprite reuse"
```

---

### Task 3: Create Texture Generator

Generate all creature and particle textures programmatically from Graphics at renderer init time.

**Files:**
- Create: `src/render/textures.ts`

**Step 1: Write the texture generator**

```typescript
import { Graphics, Texture, Application } from 'pixi.js';

export interface GeneratedTextures {
  herbivore: Texture;
  predator: Texture;
  plant: Texture;
  particle: Texture;
}

export function generateTextures(app: Application): GeneratedTextures {
  // Herbivore: soft rounded blob, 16x16
  const herbG = new Graphics();
  herbG.circle(0, 0, 6);
  herbG.fill({ color: 0xffffff });
  const herbivore = app.renderer.generateTexture({
    target: herbG,
    resolution: 2,
  });

  // Predator: angular diamond shape, 16x16
  const predG = new Graphics();
  predG.moveTo(0, -7);
  predG.lineTo(5, 0);
  predG.lineTo(0, 4);
  predG.lineTo(-5, 0);
  predG.closePath();
  predG.fill({ color: 0xffffff });
  const predator = app.renderer.generateTexture({
    target: predG,
    resolution: 2,
  });

  // Plant: tiny soft dot, 8x8
  const plantG = new Graphics();
  plantG.circle(0, 0, 3);
  plantG.fill({ color: 0xffffff });
  const plant = app.renderer.generateTexture({
    target: plantG,
    resolution: 2,
  });

  // Particle: tiny 4x4 dot for death/birth effects
  const partG = new Graphics();
  partG.circle(0, 0, 2);
  partG.fill({ color: 0xffffff });
  const particle = app.renderer.generateTexture({
    target: partG,
    resolution: 2,
  });

  // Destroy temporary graphics
  herbG.destroy();
  predG.destroy();
  plantG.destroy();
  partG.destroy();

  return { herbivore, predator, plant, particle };
}
```

Note: Textures are white — we tint them per-sprite at render time for color. This is the standard PixiJS pattern for efficient color variation.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/render/textures.ts
git commit -m "feat: add procedural texture generation for creature sprites"
```

---

### Task 4: Rewrite Renderer to Use Sprites

Replace the entire `renderer.ts` with sprite-pooled rendering. This is the biggest task.

**Files:**
- Rewrite: `src/render/renderer.ts` (complete replacement)

**Step 1: Write the new renderer**

The new renderer should:

1. **Init**: Create `Application`, generate textures via `generateTextures()`, create containers (`backgroundLayer`, `plantContainer`, `particleContainer`, `herbivoreContainer`, `predatorContainer`), create sprite pools for each type.

2. **render(state, time)** method:
   - Update background tint based on season (lerp between seasonal colors).
   - Release all sprite pools.
   - For each live plant cell (density > 0.05): acquire plant sprite, set position, set tint to `0x2a6e3a`, set alpha based on density, set scale based on density.
   - For each herbivore: acquire herbivore sprite, set position, set tint to `0x44cc77`, set alpha based on vision + energy, set scale based on size trait + breathing animation, set rotation to `atan2(vel.y, vel.x)`.
   - For each predator: acquire predator sprite, set position, set tint to `0xee6655`, set alpha, set scale based on size + prowl animation (elongation in movement direction via scaleX/scaleY), set rotation.
   - Process `state.events`: for each death event, spawn 4 particle sprites that fade and move outward. For each birth event, spawn 1 particle sprite (white tinted) that fades.
   - Update active particles (move, fade, remove when alpha <= 0).

3. **Particle system**: Track active particles in an array with `{ sprite, vx, vy, life, maxLife }`. Each frame decrement life, update position, update alpha = life/maxLife, release when done.

4. **Seasonal background**: Use a Graphics rect as the background layer. Tint shifts subtly:
   - Spring: `0x0a0f0a`, Summer: `0x0f0f0a`, Autumn: `0x0f0a0a`, Winter: `0x0a0a0f`
   - Lerp between them based on `state.season`.

5. **Breathing/prowl animation**: Use `state.time` to compute sinusoidal scale oscillation:
   - Herbivore: `baseScale * (1 + 0.06 * sin(time * 3 + id * 0.7))`
   - Predator scaleX: `baseScale * (1 + 0.08 * sin(time * 4 + id * 0.5))`, scaleY inversely

6. **Low energy**: If `energy < 25`, multiply alpha by `max(0.35, energy / 25)`.

7. **Trails**: Keep the old trail approach (Graphics layer + fade overlay) for compatibility with the `T` toggle.

Key signature change: `render(state: SimState, time: number)` — needs wall-clock `time` for animations.

**Step 2: Update main.ts to pass time to render**

In `src/main.ts`, change the render call in the loop from:
```typescript
this.renderer.render(this.sim.state);
```
to:
```typescript
this.renderer.render(this.sim.state, this.sim.state.time);
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Manual test in browser**

Run: `npx vite`
Open browser. Verify:
- Herbivores are round green shapes that rotate to face direction.
- Predators are angular red shapes that rotate.
- Plants are small soft green dots.
- Creatures pulse gently (breathing animation).
- Low-energy creatures appear translucent.
- Death creates small particle burst.
- Birth creates brief white flash.
- Background shifts subtly with seasons (very subtle, check by pressing 4 for 4x speed).

**Step 5: Commit**

```bash
git add src/render/renderer.ts src/main.ts
git commit -m "feat: rewrite renderer with pooled sprites, animations, and particle effects"
```

---

### Task 5: Add Simulation Timer to UI

Display elapsed simulation time in the stats overlay.

**Files:**
- Modify: `src/ui/overlay.ts:224-238` (updateStats method)
- Modify: `src/ui/overlay.ts` (updateStats signature)
- Modify: `src/main.ts:99` (pass time to updateStats)
- Modify: `src/styles.css` (add timer style)

**Step 1: Update updateStats to accept sim time**

Change the `updateStats` method signature in `src/ui/overlay.ts` to:

```typescript
updateStats(stats: SimStats, simTime: number): void {
```

Add a time formatting helper:

```typescript
private formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

Add the timer line to the stats HTML, at the top:

```html
<div><span class="label">Time:</span> <span class="value">${this.formatTime(simTime)}</span></div>
```

**Step 2: Update main.ts to pass simTime**

Change line 99 from:
```typescript
this.ui.updateStats(this.sim.state.stats);
```
to:
```typescript
this.ui.updateStats(this.sim.state.stats, this.sim.state.time);
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/ui/overlay.ts src/main.ts
git commit -m "feat: add simulation elapsed time to stats overlay"
```

---

### Task 6: Final Build Verification

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Production build**

Run: `npx vite build`
Expected: Build succeeds.

**Step 3: Dev server smoke test**

Run: `npx vite`
Open browser. Verify all features from Task 4 manual test + timer from Task 5.

**Step 4: Commit any remaining fixes**

If anything was adjusted during verification, commit.
