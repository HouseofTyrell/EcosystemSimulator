# Phase 3: Observability + Visual Polish

## Overview

Add real-time observability tools (population graph, creature inspector, event feed) and improve visual clarity (mountains, better water, color distinction, emptier start). Enable live balance tuning.

## Visual Improvements

### Color Distinction

Herbivores are too similar to plants and fertile terrain (all green). Fix:
- Herbivores: Shift to bright cyan-green `#55ddaa` (was `#44cc77`)
- Add subtle glow ring around all creatures so they pop against any background
- Plants stay muted dark green `#2a6e3a`, fertile terrain stays `#1a3a1a`

### Mountains

New `TerrainType.Mountain = 3`:
- Generated from existing noise field: values > 0.75 become mountains
- Impassable like water — creatures steer around, no plant growth
- Rendered as grey-brown tiles (`#3a3530`) with lighter edges for elevation feel
- Creates natural corridors and isolated ecosystem pockets

### Water Enhancement

- Deeper blue tint (`#1a3a6a`) with subtle alpha shimmer (slow sine wave on alpha)
- Slightly larger visual presence so water bodies read clearly

### Emptier Start

- Starting plant density: 3% of carrying capacity (was 10%)
- Herbivore spawn interval: 3s (was 2s)
- Predator start delay: 25s (was 15s)
- Scavenger start delay: 18s (was 10s)
- First ~30s should feel like a barren world slowly coming alive

## Observability Features

### Population Sparkline

- Position: Bottom edge, full width, 60px tall
- Rendering: Dedicated `<canvas>` element, Canvas 2D (not PixiJS)
- Data: Rolling buffer of ~300 points, sampled every 1s sim time
- Lines: Cyan-green (`#55ddaa`) herbivores, red (`#cc5544`) predators, gold (`#ccaa44`) scavengers, dark green (`#336633`) plant density (scaled)
- Y-axis auto-scales to max value in window. Thin gridline at midpoint.
- Background: `rgba(10, 10, 15, 0.7)`
- Toggle: `G` key. Visible by default.

### Creature Inspector

- Trigger: Click PixiJS canvas, hit-test nearest creature within 20px
- Panel: Right side, below settings. Shows:
  - Type + ID ("Herbivore #42")
  - Energy bar (visual fill)
  - Age / Max Age
  - All traits (speed, size, vision, etc.)
  - Current state hint (hungry, fleeing, hunting, wandering)
- Multiple pins: Up to 3 creatures. Each gets a card.
- Dead creatures show "Dead" label, card fades after 3s.
- Highlight: Pulsing ring around selected creature in renderer
- Dismiss: X on card, or Escape to clear all
- Interaction: Click coordinates mapped from overlay to sim world space

### Event Feed

- Position: Bottom-right, above seed display, ~200px wide, max 6 visible entries
- Events logged:
  - Environmental events start/end ("Drought began", "Bloom ended")
  - Species extinction / recovery
  - Population milestones (25, 50, 100 for any species)
  - Mass die-off (>30% of a species in 10s window)
- Format: Timestamp + colored text
- Entries fade after 30s
- Toggle: `F` key. Visible by default.

### Expanded Balance Tuning

New sliders in settings panel ("Balance" section):
- Herb Reproduction Energy (40–160, default 80)
- Pred Reproduction Energy (50–200, default 100)
- Scav Reproduction Energy (30–120, default 60)
- Pred Attack Energy (20–80, default 40)
- Herb Max Age (30–120, default 60)
- Pred Max Age (25–100, default 50)

These map directly to existing SimConfig fields.

## New Keyboard Bindings

- `G` — Toggle population graph
- `F` — Toggle event feed
- `Escape` — Clear creature inspection pins

## Technical Notes

- Population graph uses a separate Canvas 2D element, not PixiJS. Simple and decoupled.
- Creature inspector requires click event handling on the PixiJS canvas, mapping screen coords to world coords, then nearest-neighbor search against all creatures.
- Event feed needs a new event classification system in the simulation layer to detect milestones and mass die-offs (track recent death counts per species).
- Mountain terrain extends existing noise-based generation. Same steering avoidance as water.
