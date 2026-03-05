# Phase 10: Multiple Species, Mating & Tuning — Design

**Goal:** Introduce 6 subspecies (2 per role) with distinct traits and hue ranges, replace asexual spawning with a two-parent mating system, fix predator energy balance, slow sim speed for cinematic pacing, and make the population graph a draggable box.

**Key problems to solve:**
1. Single species per role — no visual variety or competitive dynamics
2. Predator satiation trap — stop hunting at 80 energy, need 100 to reproduce
3. Asexual spawning feels unnatural — no pairing behavior
4. 1x sim speed too fast for YouTube readability
5. Population graph too wide — takes up entire bottom of screen

---

## Section 1: Subspecies Data Model

Add `subspecies` field (0 or 1) to Agent interface. Each subspecies has a definition object with name, hue base, and trait ranges. Stored as constant lookup tables.

**Herbivores:**
- **Grazer** (0): Slow, large, high stamina, strong herd cohesion. Blue-green hue (0x44ccaa). Speed 35-60, size 3-5, vision 40-80.
- **Forager** (1): Fast, small, wide vision, more solitary. Yellow-green hue (0x88dd44). Speed 60-95, size 1.5-3, vision 70-130.

**Predators:**
- **Stalker** (0): Fast, solo hunter, high attack rate. Orange-red hue (0xee6644). Speed 70-100, size 2.5-4, vision 80-150.
- **Pack Hunter** (1): Slower, stronger pack bonus, higher group energy gain. Purple-red hue (0xcc44aa). Speed 50-80, size 3-5.5, vision 60-120.

**Scavengers:**
- **Vulture** (0): Fast, wide vision, finds corpses first but eats slowly. Pale gold hue (0xddcc55). Speed 50-80, size 1.5-3, vision 80-140.
- **Beetle** (1): Slow, small vision, eats fast and reproduces cheaply. Dark amber hue (0xaa7722). Speed 30-55, size 2-4, vision 40-80.

On creation, subspecies chosen 50/50 randomly. On reproduction, offspring inherit parent's subspecies. Traits clamped to subspecies ranges.

---

## Section 2: Predator Energy Rebalance

**Root cause:** Satiation trap — predators stop hunting at 80 energy but need 100 to reproduce. They drain ~5/sec while refusing to hunt.

**Fixes:**
- Raise satiation threshold from 0.8x to 1.2x reproduction energy (120). Predators hunt through reproduction threshold.
- Increase kill energy from 40 to 50. Fewer kills needed to recover after reproducing.
- Remove starvation acceleration added in Phase 9 (was making problem worse).
- Stalkers get +10% kill energy (solo reward). Pack Hunters get 1.5x energy when grouped.

---

## Section 3: Mating System

Replace asexual reproduction with two-parent sexual reproduction.

**Mechanics:**
- Must meet existing requirements (energy threshold, cooldown, not baby)
- Must find mate within 60px, same subspecies, energy above 50% of reproduction threshold
- Both parents pay half energy cost each
- Offspring spawns at midpoint between parents
- Traits blended from both parents (random lerp 0.3-0.7 per trait) plus mutation
- Both parents get reproduction cooldown
- New "seeking mate" behavior: steer toward nearest eligible mate when ready to reproduce

**Visual feedback:**
- Sparkle particle burst at mating midpoint
- Feed event with subspecies name

---

## Section 4: Simulation Speed

Halve base dt multiplier. 1x = half current speed (cinematic). Speed buttons still multiply on top:
- 1x = 0.5x current (watchable)
- 2x = 1.0x current
- 4x = 2.0x current

---

## Section 5: Population Graph as Box

Change from full-width bottom bar to 350x120px draggable box in bottom-right corner. Same styling and drag system as other UI panels.

---

## Future Phase (noted)

Animated sprite entities with distinct silhouettes per subspecies.

---

## Change Summary

| Change | Files |
|--------|-------|
| Subspecies data model + definitions | types.ts, new subspecies.ts |
| Subspecies assignment + trait clamping | agents.ts |
| Subspecies hue rendering | renderer.ts |
| Subspecies in inspector/stats/feed | inspector.ts, overlay.ts, simulation.ts |
| Satiation threshold 0.8x to 1.2x | agents.ts |
| Kill energy 40 to 50 | types.ts |
| Remove starvation acceleration | agents.ts |
| Pack Hunter energy bonus | agents.ts |
| Two-parent mating reproduction | agents.ts |
| Trait blending from both parents | agents.ts |
| Mate-seeking behavior state | agents.ts |
| Mating particle burst | renderer.ts |
| Sim speed 0.5x base | main.ts |
| Graph as draggable box | graph.ts, styles.css |
