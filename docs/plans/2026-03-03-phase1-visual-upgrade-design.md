# Phase 1: Visual Foundation & Readability

## Overview

Replace plain dot rendering with small animated sprites, add visual feedback for lifecycle events, and improve observability. This is the foundation for future phases (simulation depth, full observability).

## Sprite System

### Approach

Generate sprite textures programmatically at startup using PixiJS Graphics drawn to textures. No external image assets. Pool sprite objects for efficient reuse.

### Herbivore Sprites

- **Base size**: 12x12px, scaled by `size` trait
- **Shape**: Rounded blob/oval body
- **Color**: Soft green (`#44cc77`), alpha/brightness encodes vision range
- **Animation**: 2-frame "breathing" pulse via scale oscillation (sinusoidal, ~2s period)
- **Facing**: Sprite rotates to match velocity direction
- **Low energy**: Creatures below 25% energy become semi-transparent (alpha *= 0.5)

### Predator Sprites

- **Base size**: 14x14px, scaled by `size` trait
- **Shape**: Angular/diamond body with pointed nose in forward direction
- **Color**: Warm red (`#ee6655`), alpha/brightness encodes vision range
- **Animation**: 2-frame "prowl" cycle (slight elongation along movement axis, ~1.5s period)
- **Facing**: Rotates to velocity direction
- **Low energy**: Same transparency treatment as herbivores

### Plant Rendering

- Small 4px soft-glow circles (using radial gradient texture)
- Gentle alpha pulse synced to seasonal multiplier
- Denser cells render slightly larger (1.5 + density * 2.5)
- Keep grid-based rendering but use sprites instead of Graphics redraws

## Visual Effects

### Death Particles

- When a creature dies: 3-5 tiny particles burst outward from death position
- Same color family as creature (green for herbivore, red for predator)
- Particles shrink and fade over ~0.8 seconds
- Pooled and reused

### Birth Flash

- Brief white-tinted glow at birth location
- Small expanding ring that fades over ~0.5 seconds

### Season Background Shift

- Background color shifts subtly with season:
  - Spring: `#0a0f0a` (slight green tint)
  - Summer: `#0f0f0a` (warm)
  - Autumn: `#0f0a0a` (slight red)
  - Winter: `#0a0a0f` (cool blue, current default)
- Smooth lerp between seasonal colors

## Simulation Timer

- Display elapsed simulation time in the stats overlay (top-left)
- Format: `MM:SS` or `HH:MM:SS` if over an hour
- Accounts for speed multiplier (shows sim time, not wall clock)

## Technical Architecture

### Object Pooling

```
SpritePool<T>:
  - acquire(): T  — get from pool or create new
  - release(sprite: T) — return to pool, hide
  - reset() — release all
```

One pool per entity type (herbivore, predator, plant, particle).

### Texture Generation

At startup, generate textures:
1. `herbivoreTexture` — soft green circle with slight gradient
2. `predatorTexture` — angular diamond shape
3. `plantTexture` — tiny soft glow dot
4. `particleTexture` — 2px white circle for death/birth effects

Use `app.renderer.generateTexture(graphics)` to bake Graphics into GPU textures.

### Rendering Pipeline Change

**Before**: Clear Graphics → redraw all shapes every frame (CPU-heavy for many entities)

**After**: Pool Sprite objects → update position/rotation/alpha/scale each frame (GPU-batched)

This should significantly improve performance at high entity counts.

### Layer Structure

```
stage
├── backgroundLayer (season-tinted rect)
├── plantContainer (pooled plant sprites)
├── particleContainer (death/birth effects)
├── herbivoreContainer (pooled herbivore sprites)
└── predatorContainer (pooled predator sprites)
```

## Future Phases (Out of Scope)

- Phase 2: Terrain, biomes, scavengers, social behavior, environmental events
- Phase 3: Population graphs, creature inspection, event feed
