# Phase 9: YouTube-Ready Simulation — Design

**Goal:** Transform the simulator into a compelling 15-minute timelapse that produces visible Lotka-Volterra population waves, territorial herding, and dramatic boom-bust cycles suitable for data-visualization-style YouTube content.

**Key problems to solve:**
1. Creatures clump at corners/edges due to hard wall bounce + cohesion feedback loops
2. No visible spatial structure (herds, territories) — just random scatter
3. Population dynamics can stagnate instead of producing guaranteed oscillation cycles
4. No macro-scale visual narrative for zoomed-out viewing

---

## Section 1: Soft Boundary Repulsion

Replace hard wall bounce with smooth repulsion zones. Creatures feel an increasing steering force pushing them inward starting 120px from each edge. Force follows inverse-square curve: `strength * (1 - dist/margin)^2` where margin=120 and strength~200.

Remove velocity reversal (`vel *= -0.5`) from boundary handling. Keep position clamping as safety fallback only.

**Files:** `src/sim/agents.ts`

---

## Section 2: Territorial Herding

**Herbivore herding:**
- Strengthen cohesion for same-lineage creatures (0.12 -> 0.25), weaken for different lineages
- Birth position memory: each creature remembers birthplace, weak drift back when >400px away (strength ~5)
- Creates 2-4 visible herds occupying distinct regions

**Predator territory:**
- Satiated predators patrol near nearest herd cluster instead of random wandering
- Creates visible predator-prey spatial relationships

**Scavengers:** No change needed — already follow corpses which cluster at kill zones.

**Files:** `src/sim/types.ts`, `src/sim/agents.ts`

---

## Section 3: Population Drama Pacing

Target: 3-4 minute full boom-bust cycles (4-5 cycles per 15-minute video).

**Oscillation tuning:**
- Lower soft cap ratio from 0.7 to 0.5 (sharper peaks)
- Predator starvation acceleration: metabolism +50% when energy < 30% (faster crashes)
- Pacing targets: herbivore peak 300-500, predator peak 80-150 (lagging ~60s), crash ~30-45s, recovery ~60-90s

**Event pacing:**
- Reduce cooldown from 30-90s to 20-60s
- More frequent events create compound crises (drought + predator peak)

**Files:** `src/sim/agents.ts`, `src/sim/events.ts`

---

## Section 4: Live Population Graph

Small real-time line chart (bottom-right, ~300x120px) showing rolling 3-minute population history.

- Three lines: green (herbivores), red (predators), gold (scavengers)
- Sample every 0.5s, circular buffer of 360 samples
- Auto-scaling Y-axis, thin reference lines at 25%/75%
- Current count labels at right edge of each line
- HTML5 canvas overlay, semi-transparent dark background

**Files:** New `src/ui/population-graph.ts`, modify `src/main.ts`

---

## Change Summary

| Change | Files | Impact |
|--------|-------|--------|
| Soft boundary repulsion | agents.ts | Fixes edge clumping |
| Remove hard wall bounce | agents.ts | Natural steering at edges |
| Lineage-based cohesion | agents.ts | Visible herds form |
| Birth position memory | types.ts, agents.ts | Herds stay in regions |
| Satiated predator patrol | agents.ts | Predators orbit herds |
| Lower soft cap to 0.5 | agents.ts | Sharper population peaks |
| Predator starvation accel | agents.ts | Faster crashes after overhunting |
| Event cooldown reduction | events.ts | More frequent drama |
| Population graph overlay | New: population-graph.ts, main.ts | Visual narrative backbone |

**No new simulation mechanics.** Tuning existing systems + one new UI element.
