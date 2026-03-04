# Phase 3: Observability + Visual Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add mountains, improve visual clarity (color distinction, water rendering), make the start emptier, add population graph, creature inspector, event feed, and expanded balance tuning sliders.

**Architecture:** Nine independent-ish tasks. Tasks 1-4 are visual/sim changes (terrain, colors, water, start pacing). Tasks 5-8 are UI observability features (graph, inspector, feed, sliders). Task 9 is final integration. Tasks 1-4 can be parallelized. Tasks 5-8 can be parallelized. Task 9 depends on all others.

**Tech Stack:** TypeScript, PixiJS v8, Canvas 2D (for sparkline graph), HTML/CSS overlays

---

### Task 1: Mountain Terrain

Add `TerrainType.Mountain = 3` as impassable terrain with distinct rendering.

**Files:**
- Modify: `src/sim/types.ts:62-66` (add Mountain to enum)
- Modify: `src/sim/terrain.ts:42-49` (add mountain threshold to generation)
- Modify: `src/sim/plants.ts:42-47` (block plant growth on mountains)
- Modify: `src/sim/agents.ts:256-273,339-357,421-439` (add mountain avoidance to all 3 steering functions)
- Modify: `src/sim/simulation.ts:111-118` (exclude mountains from spawn positions)
- Modify: `src/render/renderer.ts:212-233` (render mountain tiles)

**Changes:**

1. In `src/sim/types.ts`, add `Mountain = 3` to the `TerrainType` const enum (after `Fertile = 2`).

2. In `src/sim/terrain.ts:generateTerrain`, change the threshold logic at lines 43-49:
```typescript
if (val < 0.35) {
  terrain[idx] = TerrainType.Water;
} else if (val < 0.50) {
  terrain[idx] = TerrainType.Fertile;
} else if (val > 1.15) {
  terrain[idx] = TerrainType.Mountain;
} else {
  terrain[idx] = TerrainType.Land;
}
```
Note: `val` ranges from 0 to ~1.5 (sum of two noise octaves), so `> 1.15` catches the top ~15% of values as mountains.

3. In `src/sim/plants.ts:updatePlants`, at line 44, change the water-only check to also block mountains:
```typescript
if (terrain[i] === TerrainType.Water || terrain[i] === TerrainType.Mountain) {
  grid[i] = 0;
  continue;
}
```

4. In all three steering functions in `src/sim/agents.ts`, change every `=== TerrainType.Water` terrain check to also include mountains. There are 3 identical blocks (one per species). In each, replace:
```typescript
if (getTerrainAt(state.terrain, cp.x, cp.y, config) === TerrainType.Water) {
```
with:
```typescript
const t = getTerrainAt(state.terrain, cp.x, cp.y, config);
if (t === TerrainType.Water || t === TerrainType.Mountain) {
```
Do this in `steerHerbivore` (line 266), `steerPredator` (line 350), and `steerScavenger` (line 432).

5. In `src/sim/simulation.ts:findLandPosition` (line 117), change the while condition to also exclude mountains:
```typescript
} while (
  getTerrainAt(this.state.terrain, x, y, config) === TerrainType.Water ||
  getTerrainAt(this.state.terrain, x, y, config) === TerrainType.Mountain
);
```

6. In `src/render/renderer.ts`, in the terrain rendering loop (lines 212-233), add mountain rendering. After the water block (`if (t === 1)`), add:
```typescript
} else if (t === 3) {
  // Mountain
  sprite.tint = 0x3a3530;
  sprite.alpha = 0.5;
```

**Verify:** Run `npx tsc --noEmit`. Run `npx vite build`. Visually confirm mountains appear as grey-brown patches, creatures avoid them, no plants grow on them.

**Commit:** `git add src/sim/types.ts src/sim/terrain.ts src/sim/plants.ts src/sim/agents.ts src/sim/simulation.ts src/render/renderer.ts && git commit -m "feat: add mountain terrain type with impassable barriers"`

---

### Task 2: Water Visual Enhancement

Make water more visible with deeper blue and subtle shimmer.

**Files:**
- Modify: `src/render/renderer.ts:223-227` (water tint and shimmer)

**Changes:**

In the renderer terrain loop, replace the water rendering block:
```typescript
if (t === 1) {
  // Water
  sprite.tint = 0x1a2a4a;
  sprite.alpha = 0.35;
}
```
with:
```typescript
if (t === 1) {
  // Water with shimmer
  sprite.tint = 0x1a3a6a;
  sprite.alpha = 0.4 + 0.08 * Math.sin(time * 1.5 + x * 0.3 + y * 0.5);
  sprite.scale.set(1.4);
}
```
Note: The `render` method already receives `time` as a parameter. `x` and `y` are the loop variables already in scope.

**Verify:** `npx tsc --noEmit`. Visually confirm water is deeper blue and subtly shimmers.

**Commit:** `git add src/render/renderer.ts && git commit -m "feat: enhance water rendering with deeper blue and shimmer"`

---

### Task 3: Color Distinction + Creature Glow

Shift herbivore color and add glow texture for all creatures.

**Files:**
- Modify: `src/render/renderer.ts:269,327` (herbivore and scavenger tint)
- Modify: `src/render/textures.ts` (add glow texture)
- Modify: `src/render/renderer.ts` (add glow ring rendering for all creatures)
- Modify: `src/render/sprite-pool.ts` (no changes needed if using existing pool)

**Changes:**

1. In `src/render/renderer.ts`, change herbivore tint from `0x44cc77` to `0x55ddaa` (line 269).

2. In `src/render/textures.ts`, add a glow ring texture to `GeneratedTextures` interface and generation:
```typescript
export interface GeneratedTextures {
  herbivore: Texture;
  predator: Texture;
  scavenger: Texture;
  plant: Texture;
  particle: Texture;
  glow: Texture; // NEW
}
```
Add glow generation before the cleanup section:
```typescript
// Glow: ring for creature highlight
const glowG = new Graphics();
glowG.circle(0, 0, 10);
glowG.stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
const glow = app.renderer.generateTexture({ target: glowG, resolution: 2 });
glowG.destroy();
```
Return: `{ herbivore, predator, scavenger, plant, particle, glow }`

3. In `src/render/renderer.ts`, add a `glowPool` (SpritePool) and `glowContainer` (Container):
- Add `private glowContainer: Container;` and `private glowPool!: SpritePool;` fields
- In constructor: `this.glowContainer = new Container();`
- In `init`, add `this.glowContainer` to stage before creature containers (after plantContainer)
- Create pool: `this.glowPool = new SpritePool(this.textures.glow, this.glowContainer);`

4. In the `render` method, after `this.predPool.releaseAll();` add `this.glowPool.releaseAll();`

5. In each creature rendering loop (herbivores, predators, scavengers), after setting the creature sprite's position, add a glow ring behind it:
```typescript
const glow = this.glowPool.acquire();
glow.x = sprite.x;
glow.y = sprite.y;
glow.tint = sprite.tint;
glow.alpha = 0.3 + 0.1 * Math.sin(time * 2 + h.id);
glow.scale.set(baseScale * 1.8);
```
(Use `h.id`, `p.id`, or `s.id` as appropriate for each loop.)

**Verify:** `npx tsc --noEmit`. Visually confirm herbivores are now cyan-green, clearly distinct from plants. All creatures have a soft glow ring.

**Commit:** `git add src/render/renderer.ts src/render/textures.ts && git commit -m "feat: improve color distinction with cyan-green herbivores and creature glow rings"`

---

### Task 4: Emptier Start

Reduce starting plant density and slow spawner intervals.

**Files:**
- Modify: `src/sim/plants.ts:11` (reduce initial density)
- Modify: `src/sim/simulation.ts:91-95` (slow spawn intervals)

**Changes:**

1. In `src/sim/plants.ts:createPlantGrid`, change line 11 from:
```typescript
grid[i] = config.plantCarryingCapacity * 0.1;
```
to:
```typescript
grid[i] = config.plantCarryingCapacity * 0.03;
```

2. In `src/sim/simulation.ts:createSpawnQueues`, change the spawn timings:
```typescript
return {
  herb: { remaining: config.initialHerbivores, interval: 3, timer: 0, startDelay: 3 },
  pred: { remaining: config.initialPredators, interval: 5, timer: 0, startDelay: 25 },
  scav: { remaining: config.initialScavengers, interval: 4, timer: 0, startDelay: 18 },
};
```

**Verify:** `npx tsc --noEmit`. Run dev server. First 30s should feel barren — sparse plants, herbivores trickling in slowly, predators not appearing until ~25s.

**Commit:** `git add src/sim/plants.ts src/sim/simulation.ts && git commit -m "feat: emptier start with 3% plant density and slower spawn intervals"`

---

### Task 5: Population Sparkline Graph

Create a Canvas 2D sparkline showing population counts over time.

**Files:**
- Create: `src/ui/graph.ts`
- Modify: `src/styles.css` (add graph styles)
- Modify: `src/main.ts` (instantiate and update graph)
- Modify: `src/ui/overlay.ts` (add G key binding)

**Changes:**

1. Create `src/ui/graph.ts`:
```typescript
import type { SimStats } from '../sim/types';

const MAX_POINTS = 300;
const GRAPH_HEIGHT = 60;

interface DataPoint {
  herbivores: number;
  predators: number;
  scavengers: number;
  plantDensity: number;
}

export class PopulationGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private data: DataPoint[] = [];
  private lastSampleTime: number = -1;
  private visible: boolean = true;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'population-graph';
    this.canvas.height = GRAPH_HEIGHT;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.style.width = window.innerWidth + 'px';
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  update(stats: SimStats, simTime: number): void {
    // Sample every 1s of sim time
    const sampleTime = Math.floor(simTime);
    if (sampleTime <= this.lastSampleTime) return;
    this.lastSampleTime = sampleTime;

    this.data.push({
      herbivores: stats.herbivoreCount,
      predators: stats.predatorCount,
      scavengers: stats.scavengerCount,
      plantDensity: stats.plantDensity * 100, // scale up for visibility
    });

    if (this.data.length > MAX_POINTS) {
      this.data.shift();
    }

    if (this.visible) this.draw();
  }

  reset(): void {
    this.data = [];
    this.lastSampleTime = -1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = GRAPH_HEIGHT;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(10, 10, 15, 0.7)';
    ctx.fillRect(0, 0, w, h);

    if (this.data.length < 2) return;

    // Find max for auto-scale
    let max = 1;
    for (const d of this.data) {
      max = Math.max(max, d.herbivores, d.predators, d.scavengers, d.plantDensity);
    }
    max *= 1.1; // headroom

    // Gridline at midpoint
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    // Draw lines
    const lines: { key: keyof DataPoint; color: string }[] = [
      { key: 'plantDensity', color: '#336633' },
      { key: 'scavengers', color: '#ccaa44' },
      { key: 'predators', color: '#cc5544' },
      { key: 'herbivores', color: '#55ddaa' },
    ];

    const step = w / (MAX_POINTS - 1);
    const offsetX = (MAX_POINTS - this.data.length) * step;

    for (const line of lines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < this.data.length; i++) {
        const x = offsetX + i * step;
        const y = h - (this.data[i][line.key] / max) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
```

2. Add to `src/styles.css`:
```css
#population-graph {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 60px;
  pointer-events: none;
}
```

3. In `src/main.ts`:
- Import: `import { PopulationGraph } from './ui/graph';`
- Add field: `private graph!: PopulationGraph;`
- After UI creation in `start()`: `this.graph = new PopulationGraph(container);`
- In the resize handler, add: `this.graph.resize();`
- In the `loop` method, after `this.ui.updateStats(...)`: `this.graph.update(this.sim.state.stats, this.sim.state.time);`
- In `reset()`, add: `this.graph.reset();`

4. In `src/ui/overlay.ts:setupKeyboard`, add a case for `KeyG`:
```typescript
case 'KeyG':
  cb.onConfigChange('graph', true); // toggled by main
  break;
```
Add `onGraphToggle` to `UICallbacks`:
Actually simpler: use the existing `onConfigChange` pattern with key `'graph'`. In `src/main.ts:handleConfigChange`, add:
```typescript
if (key === 'graph') {
  this.graph.toggle();
  return;
}
```

5. Add `G` to the help text in overlay.ts:
```html
<div><span class="key">G</span> Toggle graph</div>
```

**Verify:** `npx tsc --noEmit`. Run dev server. Graph should appear at bottom, lines should grow as simulation runs. Press G to toggle.

**Commit:** `git add src/ui/graph.ts src/styles.css src/main.ts src/ui/overlay.ts && git commit -m "feat: add population sparkline graph at bottom of screen"`

---

### Task 6: Creature Inspector

Click-to-pin creature info panels with highlight ring.

**Files:**
- Create: `src/ui/inspector.ts`
- Modify: `src/styles.css` (inspector panel styles)
- Modify: `src/main.ts` (wire click events and update)
- Modify: `src/render/renderer.ts` (draw highlight rings for selected creatures)
- Modify: `src/ui/overlay.ts` (Escape key binding)

**Changes:**

1. Create `src/ui/inspector.ts`:
```typescript
import type { Creature, SimState } from '../sim/types';

const MAX_PINS = 3;

export interface PinnedCreature {
  id: number;
  type: 'herbivore' | 'predator' | 'scavenger';
  deadSince: number | null; // sim time when died, null if alive
}

export class CreatureInspector {
  private container: HTMLElement;
  private panelEl: HTMLDivElement;
  private pinned: PinnedCreature[] = [];
  private onClear: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.panelEl = document.createElement('div');
    this.panelEl.id = 'inspector';
    container.appendChild(this.panelEl);
  }

  get pinnedIds(): number[] {
    return this.pinned.map(p => p.id);
  }

  tryPin(state: SimState, worldX: number, worldY: number): boolean {
    // Find nearest creature within 20 world units
    let bestDist = 20 * 20;
    let bestCreature: Creature | null = null;

    const check = (c: Creature) => {
      const dx = c.pos.x - worldX;
      const dy = c.pos.y - worldY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestCreature = c;
      }
    };

    for (const h of state.herbivores) check(h);
    for (const p of state.predators) check(p);
    for (const s of state.scavengers) check(s);

    if (!bestCreature) return false;

    // Don't duplicate
    const c = bestCreature as Creature;
    if (this.pinned.some(p => p.id === c.id)) return true;

    // Evict oldest if at max
    if (this.pinned.length >= MAX_PINS) {
      this.pinned.shift();
    }

    this.pinned.push({ id: c.id, type: c.type, deadSince: null });
    return true;
  }

  removePin(id: number): void {
    this.pinned = this.pinned.filter(p => p.id !== id);
  }

  clearAll(): void {
    this.pinned = [];
  }

  update(state: SimState, simTime: number): void {
    // Update dead status and remove stale dead pins
    for (let i = this.pinned.length - 1; i >= 0; i--) {
      const pin = this.pinned[i];
      const creature = this.findCreature(state, pin.id, pin.type);
      if (!creature) {
        if (pin.deadSince === null) pin.deadSince = simTime;
        if (simTime - pin.deadSince > 3) {
          this.pinned.splice(i, 1);
        }
      }
    }

    this.render(state, simTime);
  }

  private findCreature(state: SimState, id: number, type: string): Creature | undefined {
    if (type === 'herbivore') return state.herbivores.find(h => h.id === id);
    if (type === 'predator') return state.predators.find(p => p.id === id);
    return state.scavengers.find(s => s.id === id);
  }

  private render(state: SimState, simTime: number): void {
    if (this.pinned.length === 0) {
      this.panelEl.innerHTML = '';
      return;
    }

    let html = '';
    for (const pin of this.pinned) {
      const creature = this.findCreature(state, pin.id, pin.type);
      const isDead = !creature;
      const fadeClass = isDead ? ' dead' : '';

      const colors: Record<string, string> = {
        herbivore: '#55ddaa',
        predator: '#cc5544',
        scavenger: '#ccaa44',
      };
      const color = colors[pin.type];
      const label = pin.type.charAt(0).toUpperCase() + pin.type.slice(1);

      if (isDead) {
        html += `<div class="inspector-card${fadeClass}">
          <div class="inspector-header" style="color:${color}">
            ${label} #${pin.id}
            <span class="inspector-close" data-id="${pin.id}">\u00d7</span>
          </div>
          <div class="inspector-dead">Dead</div>
        </div>`;
      } else {
        const c = creature!;
        const energyPct = Math.max(0, Math.min(100, (c.energy / 100) * 100));
        const agePct = (c.age / c.maxAge * 100).toFixed(0);

        let traitsHtml = '';
        const traits = c.traits as Record<string, number>;
        for (const [key, val] of Object.entries(traits)) {
          traitsHtml += `<div class="inspector-trait"><span>${key}</span><span>${val.toFixed(1)}</span></div>`;
        }

        // State hint
        let stateHint = 'wandering';
        if (c.energy < 30) stateHint = 'hungry';
        if (c.type === 'herbivore' && c.energy < 15) stateHint = 'starving';
        if (c.type === 'predator' && c.energy < 20) stateHint = 'desperate';

        html += `<div class="inspector-card${fadeClass}">
          <div class="inspector-header" style="color:${color}">
            ${label} #${pin.id}
            <span class="inspector-close" data-id="${pin.id}">\u00d7</span>
          </div>
          <div class="inspector-energy">
            <div class="inspector-energy-bar" style="width:${energyPct}%;background:${color}"></div>
          </div>
          <div class="inspector-row"><span>Energy</span><span>${c.energy.toFixed(0)}</span></div>
          <div class="inspector-row"><span>Age</span><span>${c.age.toFixed(0)}s / ${c.maxAge.toFixed(0)}s (${agePct}%)</span></div>
          <div class="inspector-row"><span>State</span><span>${stateHint}</span></div>
          ${traitsHtml}
        </div>`;
      }
    }

    this.panelEl.innerHTML = html;

    // Attach close handlers
    this.panelEl.querySelectorAll('.inspector-close').forEach(el => {
      el.addEventListener('click', (e) => {
        const id = parseInt((e.target as HTMLElement).dataset.id!);
        this.removePin(id);
      });
    });
  }
}
```

2. Add inspector styles to `src/styles.css`:
```css
/* Creature Inspector */
#inspector {
  position: absolute;
  top: 220px;
  right: 16px;
  width: 200px;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inspector-card {
  background: rgba(10, 10, 15, 0.88);
  border: 1px solid #223344;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 10px;
  transition: opacity 0.5s;
}

.inspector-card.dead {
  opacity: 0.4;
}

.inspector-header {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 4px;
}

.inspector-close {
  cursor: pointer;
  color: #667788;
  font-size: 14px;
  line-height: 1;
}

.inspector-close:hover {
  color: #aabbcc;
}

.inspector-energy {
  height: 3px;
  background: #1a1a2a;
  border-radius: 2px;
  margin-bottom: 4px;
  overflow: hidden;
}

.inspector-energy-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s;
}

.inspector-dead {
  color: #667788;
  font-style: italic;
  text-align: center;
  padding: 4px;
}

.inspector-row, .inspector-trait {
  display: flex;
  justify-content: space-between;
  color: #556677;
  line-height: 1.5;
}

.inspector-trait span:last-child {
  color: #7788aa;
}
```

3. In `src/main.ts`:
- Import: `import { CreatureInspector } from './ui/inspector';`
- Add field: `private inspector!: CreatureInspector;`
- After graph creation: `this.inspector = new CreatureInspector(container);`
- Add click handler in `start()`, after UI creation:
```typescript
this.renderer.app.canvas.addEventListener('click', (e) => {
  const rect = this.renderer.app.canvas.getBoundingClientRect();
  const scaleX = this.sim.state.config.worldWidth / rect.width;
  const scaleY = this.sim.state.config.worldHeight / rect.height;
  const worldX = (e.clientX - rect.left) * scaleX;
  const worldY = (e.clientY - rect.top) * scaleY;
  this.inspector.tryPin(this.sim.state, worldX, worldY);
});
```
- In loop, after graph update: `this.inspector.update(this.sim.state, this.sim.state.time);`
- In `reset()`: `this.inspector.clearAll();`
- In `handleConfigChange`, add a case for `'inspector'` that calls `this.inspector.clearAll();`

4. In `src/render/renderer.ts`:
- Add a `selectedIds: Set<number>` parameter to the `render` method signature: `render(state: SimState, time: number, selectedIds?: number[]): void`
- In herbivore/predator/scavenger rendering loops, after drawing the creature sprite, check if selected and draw a highlight ring:
```typescript
if (selectedIds && selectedIds.includes(h.id)) {
  const ring = this.glowPool.acquire();
  ring.x = sprite.x;
  ring.y = sprite.y;
  ring.tint = sprite.tint;
  ring.alpha = 0.5 + 0.3 * Math.sin(time * 4);
  ring.scale.set(baseScale * 2.5);
}
```
Do this for all 3 species loops (using `h.id`, `p.id`, `s.id`).

5. In `src/main.ts`, update the render call in `loop`:
```typescript
this.renderer.render(this.sim.state, this.sim.state.time, this.inspector.pinnedIds);
```

6. In `src/ui/overlay.ts:setupKeyboard`, add Escape handler:
```typescript
case 'Escape':
  cb.onConfigChange('inspector', true);
  break;
```
Add to help text:
```html
<div><span class="key">Esc</span> Clear inspector</div>
```

**Verify:** `npx tsc --noEmit`. Click on creatures, verify card appears. Click up to 3, verify oldest drops. Press Escape, all cleared. Dead creatures show "Dead" and fade.

**Commit:** `git add src/ui/inspector.ts src/styles.css src/main.ts src/render/renderer.ts src/ui/overlay.ts && git commit -m "feat: add click-to-pin creature inspector with highlight rings"`

---

### Task 7: Event Feed

Scrolling log of key simulation events.

**Files:**
- Create: `src/ui/feed.ts`
- Modify: `src/styles.css` (feed styles)
- Modify: `src/sim/simulation.ts` (emit feed events)
- Modify: `src/sim/types.ts` (add FeedEvent to SimState)
- Modify: `src/main.ts` (wire feed)
- Modify: `src/ui/overlay.ts` (F key binding)

**Changes:**

1. Add `FeedEvent` interface and `feedEvents` field to `src/sim/types.ts`:
```typescript
export interface FeedEvent {
  time: number;
  text: string;
  color: string;
}
```
Add to `SimState`:
```typescript
feedEvents: FeedEvent[];
```

2. Initialize `feedEvents: []` in `Simulation` constructor state object and `reset()` state object in `src/sim/simulation.ts`.

3. Add feed event detection to `src/sim/simulation.ts:step()`. After `this.computeStats()`, add a new method call `this.detectFeedEvents()`. Implement:
```typescript
private prevHerbCount: number = 0;
private prevPredCount: number = 0;
private prevScavCount: number = 0;
private milestones = new Set<string>();

private detectFeedEvents(): void {
  const state = this.state;
  const t = state.time;
  const feed = state.feedEvents;

  // Environmental events
  if (state.activeEvent && state.activeEvent.remaining >= state.activeEvent.duration - 0.02) {
    const name = state.activeEvent.type.charAt(0).toUpperCase() + state.activeEvent.type.slice(1);
    feed.push({ time: t, text: `${name} began`, color: state.activeEvent.type === 'drought' ? '#cc8844' : state.activeEvent.type === 'bloom' ? '#44cc66' : '#cc44cc' });
  }

  // Extinction / Recovery
  const checks: { name: string; count: number; prev: number; color: string }[] = [
    { name: 'Herbivores', count: state.herbivores.length, prev: this.prevHerbCount, color: '#55ddaa' },
    { name: 'Predators', count: state.predators.length, prev: this.prevPredCount, color: '#cc5544' },
    { name: 'Scavengers', count: state.scavengers.length, prev: this.prevScavCount, color: '#ccaa44' },
  ];

  for (const { name, count, prev, color } of checks) {
    if (prev > 0 && count === 0) {
      feed.push({ time: t, text: `${name} went extinct!`, color });
    }
    if (prev === 0 && count > 0 && t > 5) {
      feed.push({ time: t, text: `${name} reintroduced`, color });
    }
    // Milestones
    for (const m of [25, 50, 100]) {
      const key = `${name}-${m}`;
      if (count >= m && prev < m && !this.milestones.has(key)) {
        this.milestones.add(key);
        feed.push({ time: t, text: `${name} reached ${m}`, color });
      }
    }
  }

  this.prevHerbCount = state.herbivores.length;
  this.prevPredCount = state.predators.length;
  this.prevScavCount = state.scavengers.length;
}
```
Reset `prevHerbCount`, `prevPredCount`, `prevScavCount` and `milestones` in `reset()`.

4. Create `src/ui/feed.ts`:
```typescript
import type { FeedEvent } from '../sim/types';

const MAX_ENTRIES = 6;
const FADE_TIME = 30; // seconds before entry fades

interface FeedEntry {
  event: FeedEvent;
  addedAt: number; // wall time for fade
}

export class EventFeed {
  private el: HTMLDivElement;
  private entries: FeedEntry[] = [];
  private visible: boolean = true;
  private lastCount: number = 0;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'event-feed';
    container.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(feedEvents: FeedEvent[]): void {
    // Add new events
    const now = Date.now() / 1000;
    for (let i = this.lastCount; i < feedEvents.length; i++) {
      this.entries.push({ event: feedEvents[i], addedAt: now });
    }
    this.lastCount = feedEvents.length;

    // Remove old entries
    this.entries = this.entries.filter(e => now - e.addedAt < FADE_TIME);

    // Keep max
    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    if (!this.visible) return;
    this.render(now);
  }

  reset(): void {
    this.entries = [];
    this.lastCount = 0;
    this.el.innerHTML = '';
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private render(now: number): void {
    let html = '';
    for (const entry of this.entries) {
      const age = now - entry.addedAt;
      const alpha = Math.max(0.3, 1 - age / FADE_TIME);
      html += `<div class="feed-entry" style="opacity:${alpha}">
        <span class="feed-time">${this.formatTime(entry.event.time)}</span>
        <span style="color:${entry.event.color}">${entry.event.text}</span>
      </div>`;
    }
    this.el.innerHTML = html;
  }
}
```

5. Add feed styles to `src/styles.css`:
```css
/* Event Feed */
#event-feed {
  position: absolute;
  bottom: 70px;
  right: 16px;
  width: 200px;
  pointer-events: none;
  font-size: 10px;
}

.feed-entry {
  line-height: 1.6;
  white-space: nowrap;
}

.feed-time {
  color: #445566;
  margin-right: 6px;
}
```

6. In `src/main.ts`:
- Import: `import { EventFeed } from './ui/feed';`
- Add field: `private feed!: EventFeed;`
- After inspector creation: `this.feed = new EventFeed(container);`
- In loop: `this.feed.update(this.sim.state.feedEvents);`
- In `reset()`: `this.feed.reset();`
- In `handleConfigChange`, add `'feed'` case: `this.feed.toggle(); return;`

7. In `src/ui/overlay.ts:setupKeyboard`, add:
```typescript
case 'KeyF':
  cb.onConfigChange('feed', true);
  break;
```
Add to help text:
```html
<div><span class="key">F</span> Toggle event feed</div>
```

**Verify:** `npx tsc --noEmit`. Run sim, wait for events. Feed should show drought/bloom messages, population milestones, extinctions.

**Commit:** `git add src/ui/feed.ts src/sim/types.ts src/sim/simulation.ts src/styles.css src/main.ts src/ui/overlay.ts && git commit -m "feat: add event feed with key simulation events"`

---

### Task 8: Expanded Balance Tuning Sliders

Add per-species reproduction energy, attack energy, and max age sliders.

**Files:**
- Modify: `src/ui/overlay.ts:98-120` (add new slider rows to settings)

**Changes:**

In `src/ui/overlay.ts:buildSettings`, after the existing `settings-body` div content (after the big mutations row), add a new "Balance" section with 6 sliders:

```html
<div class="settings-divider"></div>
<div class="setting-row">
  <label>Herb Repro Energy</label>
  <input type="range" min="40" max="160" value="80" data-key="herbivoreReproductionEnergy" data-scale="1" />
  <span class="val">80</span>
</div>
<div class="setting-row">
  <label>Pred Repro Energy</label>
  <input type="range" min="50" max="200" value="100" data-key="predatorReproductionEnergy" data-scale="1" />
  <span class="val">100</span>
</div>
<div class="setting-row">
  <label>Scav Repro Energy</label>
  <input type="range" min="30" max="120" value="60" data-key="scavengerReproductionEnergy" data-scale="1" />
  <span class="val">60</span>
</div>
<div class="setting-row">
  <label>Pred Attack Energy</label>
  <input type="range" min="20" max="80" value="40" data-key="predatorAttackEnergy" data-scale="1" />
  <span class="val">40</span>
</div>
<div class="setting-row">
  <label>Herb Max Age</label>
  <input type="range" min="30" max="120" value="60" data-key="herbivoreMaxAge" data-scale="1" />
  <span class="val">60</span>
</div>
<div class="setting-row">
  <label>Pred Max Age</label>
  <input type="range" min="25" max="100" value="50" data-key="predatorMaxAge" data-scale="1" />
  <span class="val">50</span>
</div>
```

Add divider style to `src/styles.css`:
```css
.settings-divider {
  border-top: 1px solid #223344;
  margin: 8px 0;
}
```

These all use `data-scale="1"` (no scaling) since the config values are already in the right units. The existing slider event handler in `buildSettings` already sends `cb.onConfigChange(key, val)` which writes directly to the SimConfig, so no additional wiring needed.

**Verify:** `npx tsc --noEmit`. Open settings panel. New sliders should appear. Changing them should affect simulation behavior in real-time.

**Commit:** `git add src/ui/overlay.ts src/styles.css && git commit -m "feat: add balance tuning sliders for reproduction and age params"`

---

### Task 9: Final Integration + Build Verification

Verify everything works together, type checks, and builds.

**Files:**
- All files from previous tasks

**Steps:**

1. Run `npx tsc --noEmit` — must pass with 0 errors.
2. Run `npx vite build` — must succeed.
3. Run `npx vite dev` and manually verify:
   - Mountains render as grey-brown patches, creatures avoid them
   - Water is deeper blue with shimmer
   - Herbivores are clearly cyan-green, distinct from plants
   - All creatures have subtle glow rings
   - Start is empty, creatures trickle in over first 30s
   - Population graph at bottom shows colored lines growing
   - Click a creature: inspector card appears on right
   - Click up to 3, Escape clears all
   - Environmental events appear in feed
   - Balance sliders work: changing reproduction energy affects population growth
   - Press G to toggle graph, F to toggle feed
   - Press R to reset — all UI resets cleanly
   - Press N for new seed — everything regenerates

**Commit:** Final commit if any integration fixes needed.
