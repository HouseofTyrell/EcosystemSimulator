# Satellite Graphics Overhaul Design

## Goal

Transform the ecosystem simulator's visual style from abstract sprite-based rendering to an illustrated/painted satellite view — like Civilization's satellite map mode. Natural, muted, earthy aesthetics viewed from above.

## Approach

**Noise-painted terrain texture** rendered once to a cached RenderTexture, with overlay layers for vegetation density and weather. Creatures drawn as small matte-colored shapes with subtle animation. No atmospheric particles or glow effects.

## Tech Stack

- PixiJS v8 (existing)
- Multi-octave value noise (existing terrain system)
- RenderTexture caching (existing pattern)
- Per-frame sprite updates for creature animation

---

## Section 1: Terrain

**Replace** the current flat-colored terrain tiles with a single noise-painted texture.

### Color Palette
- **Land**: Warm sandy tan to olive-brown (`#C4A882` to `#8B7D5E`)
- **Fertile**: Rich dark earth to mossy green (`#5C7A3D` to `#3D5C2A`)
- **Water**: Deep teal to dark blue-green (`#2A6B6B` to `#1A4545`)
- **Mountain**: Cool grey to slate (`#8C8C8C` to `#5A5A5A`)

### Technique
- Sample existing terrain grid + noise to produce natural color variation within each biome
- Blend between biomes using distance fields for smooth shoreline/border transitions (no hard edges)
- Add micro-noise (high frequency, low amplitude) for painted texture feel
- Cache as RenderTexture, redraw only on reset

### Seasonal Tinting
- Apply as a color multiply overlay on the cached terrain
- Spring: slight green boost; Summer: warm yellow; Autumn: amber/orange; Winter: desaturated blue-grey
- Smooth transition between seasons (already have `seasonalMultiplier`)

---

## Section 2: Creatures

**Remove** glow halos and bright neon coloring. Replace with matte, natural-toned shapes.

### Visual Style
- Matte body colors derived from subspecies hue but desaturated/earthy
- Tight, subtle drop shadow (dark oval, 50% alpha, slight offset)
- Keep rotation to face movement direction
- Smaller apparent size to match satellite perspective

### Animation: Leg Movement
- 2-4 tiny dots rendered at alternating positions along the body sides
- Oscillate forward/backward based on movement speed
- Cycle rate proportional to `speed * dt`
- Stationary creatures: legs in neutral position (no oscillation)

### Animation: Body Flex
- Squish body along movement axis: slightly compressed width, slightly elongated length
- Scale factor: `1.0 + sin(phase) * 0.08` for length, inverse for width
- Phase advances with movement, stops when stationary
- Gives organic "wriggling" motion from satellite distance

### Subspecies Differentiation
- Grazers: stocky oval, earth-green
- Foragers: smaller, elongated, yellow-green
- Stalkers: sleek elongated, rust-brown
- Pack Hunters: medium build, dark purple-brown
- Vultures: small round, dusty yellow
- Beetles: compact, dark brown

---

## Section 3: Plants & Vegetation

**Remove** individual plant sprites. Vegetation becomes a terrain overlay.

### Technique
- Second overlay texture (or tinted layer) driven by `plantGrid` density values
- High density cells: rich green tint blended over terrain
- Low density cells: exposed earth/sand showing through
- Medium density: patchy green-brown mix

### Grazing Trails
- When herbivores eat from a cell, the density drops — this naturally creates visible "paths" of exposed earth through green areas
- No special rendering needed; the density-to-color mapping handles it

### Performance
- Update overlay texture periodically (every N frames, not every frame)
- Only update cells that changed since last refresh

---

## Section 4: Water & Weather Effects

**Remove** atmospheric particles (fireflies, pollen, dust motes, wind streaks).

### Weather as Terrain Modification
- **Rain**: Darken terrain colors slightly, add subtle blue tint. No particle rain.
- **Wind**: No visual effect (or very subtle directional brightness gradient)
- **Fog**: Large, soft semi-transparent grey patches overlaid on terrain. Sparse, not dense.
- **Clear**: Normal terrain colors

### Water
- Keep existing water areas from terrain
- Remove shimmer/animation effects
- Water is just its painted color from the terrain texture
- Optional: very subtle brightness oscillation (±3%) for minimal life

### Night
- Darken the entire scene via overlay (existing approach)
- Remove any glow/light point effects
- Just a smooth brightness reduction

---

## Section 5: Death & Birth Effects

**Minimize** visual effects to match satellite naturalism.

### Death
- Brief red-brown flash on the creature sprite (2-3 frames)
- Creature then disappears
- No particles, no explosion

### Corpses
- Render as a small dark ground stain at death position
- Fade opacity over the corpse decay timer
- Color: dark brown-red, roughly 60% of creature size

### Birth
- No visual effect
- New creature simply appears at spawn position
- Population changes are visible through density shifts, not individual events

---

## Performance Notes

- Terrain RenderTexture: cached, redrawn only on reset (same as current approach)
- Vegetation overlay: updated every 10-30 frames, not per-frame
- Creature animation: per-frame but minimal math (sin lookup, 2 extra dot positions)
- Fewer draw calls overall: no glow sprites, no plant sprites, no particle sprites
- Net performance should improve vs. current renderer
