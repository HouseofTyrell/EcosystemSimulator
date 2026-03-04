# Phase 5: Atmosphere Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add day/night cycle with gameplay effects and a weather system (rain, wind, fog) to create atmospheric immersion.

**Architecture:** Two main features. Day/night adds a lighting overlay + vision/speed modifiers based on time-of-day phase. Weather adds three weather types with visual particles/overlays and gameplay effects. Both are driven by SimState fields computed each tick. Renderer draws overlays on top of everything. All modifications to existing files except one new file for weather visual particles.

**Tech Stack:** TypeScript, PixiJS v8, Vite

---

### Task 1: Day/Night Cycle — Types & Simulation Logic

Add `dayNightPeriod` to SimConfig, `dayPhase` and `timeOfDay` to SimState, and compute them each tick.

**Files:**
- Modify: `src/sim/types.ts` (SimConfig, SimState, SimStats, DEFAULT_CONFIG)
- Modify: `src/sim/simulation.ts` (compute dayPhase in step, add to stats)

**Changes:**

1. In `src/sim/types.ts`, add to `SimConfig` interface after `seasonPeriod: number;` (line 86):
```typescript
  dayNightPeriod: number; // seconds for one full day/night cycle
```

Add to `SimState` interface after `seasonalMultiplier: number;` (line 132):
```typescript
  dayPhase: number; // 0-1: 0-0.25 dawn, 0.25-0.5 day, 0.5-0.75 dusk, 0.75-1.0 night
  timeOfDay: 'Dawn' | 'Day' | 'Dusk' | 'Night';
```

Add to `SimStats` after `activeEventName: string;` (line 161):
```typescript
  timeOfDay: string;
```

Add to `DEFAULT_CONFIG` after `seasonPeriod: 180,` (line 196):
```typescript
  dayNightPeriod: 90, // 90s per full day cycle (2 cycles per season)
```

2. In `src/sim/simulation.ts`, in `emptyStats()` add:
```typescript
  timeOfDay: 'Dawn',
```

In `step()`, after the season computation (line 176), add:
```typescript
    state.dayPhase = (state.time / config.dayNightPeriod) % 1;
    if (state.dayPhase < 0.25) state.timeOfDay = 'Dawn';
    else if (state.dayPhase < 0.5) state.timeOfDay = 'Day';
    else if (state.dayPhase < 0.75) state.timeOfDay = 'Dusk';
    else state.timeOfDay = 'Night';
```

In `computeStats()`, add:
```typescript
    stats.timeOfDay = state.timeOfDay;
```

In `reset()`, add to the state initialization:
```typescript
      dayPhase: 0,
      timeOfDay: 'Dawn',
```

In `constructor()`, add to the state initialization:
```typescript
      dayPhase: 0,
      timeOfDay: 'Dawn',
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/simulation.ts && git commit -m "feat: add day/night cycle data to SimConfig and SimState"`

---

### Task 2: Day/Night — Vision & Speed Modifiers in Agents

At night, all creature vision drops to 50%. Predators get +20% speed at night. Herbivores get -15% speed at night.

**Files:**
- Modify: `src/sim/agents.ts` (steering vision, speed multipliers)

**Changes:**

1. Add a helper function at the top of agents.ts after `getSpeedMultiplier`:
```typescript
function getDayNightModifiers(dayPhase: number): { visionMul: number; herbSpeedMul: number; predSpeedMul: number } {
  // Night is 0.75-1.0, transitions at dusk (0.5-0.75) and dawn (0.0-0.25)
  let nightIntensity: number;
  if (dayPhase < 0.2) {
    // Late dawn: fading from night
    nightIntensity = Math.max(0, 1 - dayPhase / 0.2);
  } else if (dayPhase < 0.55) {
    // Day
    nightIntensity = 0;
  } else if (dayPhase < 0.75) {
    // Dusk: transitioning to night
    nightIntensity = (dayPhase - 0.55) / 0.2;
  } else {
    // Night
    nightIntensity = 1;
  }

  return {
    visionMul: 1 - nightIntensity * 0.5,       // down to 50% at full night
    herbSpeedMul: 1 - nightIntensity * 0.15,    // herbivores -15% at night
    predSpeedMul: 1 + nightIntensity * 0.2,     // predators +20% at night
  };
}
```

2. In `steerHerbivore`, after `const vision = h.traits.visionRange;` (line 193), multiply by the day/night vision modifier:
```typescript
  const dayMods = getDayNightModifiers(state.dayPhase);
  const vision = h.traits.visionRange * dayMods.visionMul;
```
(Remove the original `const vision = h.traits.visionRange;` line.)

3. In `steerPredator`, after `const vision = p.traits.visionRange;` (line 306), do the same:
```typescript
  const dayMods = getDayNightModifiers(state.dayPhase);
  const vision = p.traits.visionRange * dayMods.visionMul;
```

4. In `steerScavenger`, after `const vision = s.traits.visionRange;` (line 391):
```typescript
  const dayMods = getDayNightModifiers(state.dayPhase);
  const vision = s.traits.visionRange * dayMods.visionMul;
```

5. In `updateHerbivores`, where the speed multiplier is applied (line 528), also apply herbivore night speed:
```typescript
    const dayMods = getDayNightModifiers(state.dayPhase);
    const spdMul = getSpeedMultiplier(stage) * dayMods.herbSpeedMul;
```

6. In `updatePredators`, where the speed multiplier is applied (line 649):
```typescript
    const dayMods = getDayNightModifiers(state.dayPhase);
    const spdMul = getSpeedMultiplier(stage) * dayMods.predSpeedMul;
```

7. In `updateScavengers`, where the speed multiplier is applied (line 768):
```typescript
    const dayMods = getDayNightModifiers(state.dayPhase);
    const spdMul = getSpeedMultiplier(stage) * dayMods.visionMul; // scavengers just slow slightly
```
Actually scavengers don't have a specific modifier in the design — just use base lifecycle multiplier. So leave scavengers unchanged: `const spdMul = getSpeedMultiplier(stage);`

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/agents.ts && git commit -m "feat: add day/night vision and speed modifiers for creatures"`

---

### Task 3: Day/Night — Visual Overlay in Renderer

Add a dark overlay that smoothly transitions from transparent (day) to dark blue-black (night). Add twinkling stars at night.

**Files:**
- Modify: `src/render/renderer.ts` (new overlay layer, star sprites, render logic)

**Changes:**

1. Add a new layer field after `private fadeOverlay: Graphics;`:
```typescript
  private nightOverlay: Graphics;
```

2. In constructor, initialize:
```typescript
    this.nightOverlay = new Graphics();
```

3. In `init()`, add the nightOverlay as the LAST child of stage (on top of everything):
```typescript
    this.app.stage.addChild(this.nightOverlay);
```

4. Add a helper function near the top of the file (after `mixTintGrey`):
```typescript
function getNightAlpha(dayPhase: number): number {
  // Smoothstep transition for night darkness
  let nightIntensity: number;
  if (dayPhase < 0.2) {
    nightIntensity = 1 - dayPhase / 0.2;
  } else if (dayPhase < 0.55) {
    nightIntensity = 0;
  } else if (dayPhase < 0.75) {
    nightIntensity = (dayPhase - 0.55) / 0.2;
  } else {
    nightIntensity = 1;
  }
  // Smoothstep
  const t = nightIntensity;
  return t * t * (3 - 2 * t) * 0.6; // max alpha 0.6
}
```

5. In `render()`, after the particle update section (end of method, before closing brace), add the night overlay rendering:
```typescript
    // === 10. Night overlay ===
    this.nightOverlay.clear();
    const nightAlpha = getNightAlpha(state.dayPhase);
    if (nightAlpha > 0.01) {
      this.nightOverlay
        .rect(0, 0, this.worldW, this.worldH)
        .fill({ color: 0x05050f, alpha: nightAlpha });

      // Stars at night
      if (nightAlpha > 0.2) {
        const starCount = Math.floor(nightAlpha * 40);
        for (let i = 0; i < starCount; i++) {
          // Deterministic positions based on index
          const sx = ((i * 7919 + 1013) % this.worldW);
          const sy = ((i * 6271 + 2017) % this.worldH);
          const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(time * 1.5 + i * 2.3));
          this.nightOverlay
            .circle(sx, sy, 1)
            .fill({ color: 0xffffff, alpha: nightAlpha * twinkle * 0.8 });
        }
      }
    }
```

**Verify:** `npx tsc --noEmit`. Run dev server. Should see gradual darkening/lightening cycle, stars twinkling at night.

**Commit:** `git add src/render/renderer.ts && git commit -m "feat: add day/night visual overlay with twinkling stars"`

---

### Task 4: Day/Night — UI Display

Show time of day in stats panel. Add "Day/Night" toggle in settings.

**Files:**
- Modify: `src/ui/overlay.ts` (stats display, settings toggle)
- Modify: `src/main.ts` (handle daynight toggle)
- Modify: `src/render/renderer.ts` (add setDayNight method)

**Changes:**

1. In `src/ui/overlay.ts`, in `updateStats()`, add after the Season line:
```typescript
      <div><span class="label">Time:</span> <span class="value">${stats.timeOfDay}</span></div>
```
Wait — there's already a "Time:" line showing formatted sim time. Rename that to "Sim Time:" and add a new "Period:" line:
```typescript
      <div><span class="label">Sim Time:</span> <span class="value">${this.formatTime(simTime)}</span></div>
      <div><span class="label">Period:</span> <span class="value">${stats.timeOfDay}</span></div>
```

2. In `buildSettings()`, add a "Day/Night" toggle in the Display section after the World Wrap toggle:
```html
        <div class="setting-toggle-row">
          <label>Day/Night</label>
          <input type="checkbox" checked data-toggle="daynight" />
        </div>
```

3. In the toggle change handler in `buildSettings()`, add a case for `daynight`:
Already handled by the else clause that calls `cb.onConfigChange(key, el.checked)`.

4. In `src/main.ts`, add a `dayNightEnabled` field:
```typescript
  private dayNightEnabled: boolean = true;
```

Add to `handleConfigChange`:
```typescript
    if (key === 'daynight') {
      this.dayNightEnabled = !this.dayNightEnabled;
      this.renderer.setDayNight(this.dayNightEnabled);
      return;
    }
```

5. In `src/render/renderer.ts`, add a field:
```typescript
  private dayNightEnabled: boolean = true;
```

Add method:
```typescript
  setDayNight(enabled: boolean): void {
    this.dayNightEnabled = enabled;
    if (!enabled) {
      this.nightOverlay.clear();
    }
  }
```

Guard the night overlay rendering with `if (this.dayNightEnabled)`.

**Verify:** `npx tsc --noEmit`. Run dev server. Stats should show "Period: Dawn/Day/Dusk/Night". Toggle should hide/show night effect.

**Commit:** `git add src/ui/overlay.ts src/main.ts src/render/renderer.ts && git commit -m "feat: add day/night UI display and toggle"`

---

### Task 5: Weather System — Types & Simulation Logic

Add WeatherState to SimState, weather types (rain, wind, fog), transitions, and random weather events.

**Files:**
- Modify: `src/sim/types.ts` (WeatherState, SimState, SimStats)
- Modify: `src/sim/simulation.ts` (weather update logic)

**Changes:**

1. In `src/sim/types.ts`, add after the `ActiveEvent` interface:
```typescript
export interface WeatherState {
  type: 'clear' | 'rain' | 'wind' | 'fog';
  intensity: number; // 0-1, ramps up/down during transitions
  duration: number;
  remaining: number;
  windAngle: number; // only used for wind
}
```

Add to `SimState` after `eventCooldown: number;`:
```typescript
  weather: WeatherState;
  weatherCooldown: number;
```

Add to `SimStats`:
```typescript
  weatherName: string;
```

2. In `src/sim/simulation.ts`:

In `emptyStats()`, add:
```typescript
  weatherName: 'Clear',
```

In constructor state initialization, add:
```typescript
      weather: { type: 'clear', intensity: 0, duration: 0, remaining: 0, windAngle: 0 },
      weatherCooldown: 60,
```

In `reset()` state initialization, add the same.

Add a `updateWeather` method:
```typescript
  private updateWeather(dt: number): void {
    const state = this.state;
    const weather = state.weather;

    if (weather.type !== 'clear') {
      weather.remaining -= dt;

      // Fade in/out over 3 seconds
      const fadeTime = 3;
      const elapsed = weather.duration - weather.remaining;
      if (elapsed < fadeTime) {
        weather.intensity = elapsed / fadeTime;
      } else if (weather.remaining < fadeTime) {
        weather.intensity = Math.max(0, weather.remaining / fadeTime);
      } else {
        weather.intensity = 1;
      }

      // Wind: slowly rotate angle
      if (weather.type === 'wind') {
        weather.windAngle += dt * 0.1;
      }

      if (weather.remaining <= 0) {
        weather.type = 'clear';
        weather.intensity = 0;
        state.weatherCooldown = 60 + this.rng.next() * 120;
      }
    } else {
      state.weatherCooldown -= dt;
      if (state.weatherCooldown <= 0 && this.rng.next() < 0.003) {
        const roll = this.rng.next();
        if (roll < 0.4) {
          const dur = 30 + this.rng.next() * 30;
          state.weather = { type: 'rain', intensity: 0, duration: dur, remaining: dur, windAngle: 0 };
        } else if (roll < 0.75) {
          const dur = 45 + this.rng.next() * 45;
          state.weather = { type: 'wind', intensity: 0, duration: dur, remaining: dur, windAngle: this.rng.range(0, Math.PI * 2) };
        } else {
          const dur = 20 + this.rng.next() * 20;
          state.weather = { type: 'fog', intensity: 0, duration: dur, remaining: dur, windAngle: 0 };
        }
      }
    }
  }
```

Call `this.updateWeather(dt)` in `step()` after `updateEvents`.

In `computeStats()`, add:
```typescript
    stats.weatherName = state.weather.type === 'clear' ? 'Clear' :
      state.weather.type.charAt(0).toUpperCase() + state.weather.type.slice(1);
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/types.ts src/sim/simulation.ts && git commit -m "feat: add weather system types and simulation logic"`

---

### Task 6: Weather — Gameplay Effects

Rain boosts plant growth +50%. Fog reduces all vision to 40%. Wind applies drift force to all creatures.

**Files:**
- Modify: `src/sim/simulation.ts` (plant growth multiplier for rain)
- Modify: `src/sim/agents.ts` (fog vision, wind drift)

**Changes:**

1. In `src/sim/simulation.ts`, in `step()`, modify the plant update line to include rain:
```typescript
    const weatherPlantMul = state.weather.type === 'rain' ? 1 + 0.5 * state.weather.intensity : 1;
    updatePlants(state.plantGrid, dt, state.seasonalMultiplier * eventMult * weatherPlantMul, config, state.terrain);
```

2. In `src/sim/agents.ts`, modify `getDayNightModifiers` to also accept weather state, or add a separate fog modifier. Simpler approach — add weather parameters to the update functions:

In `steerHerbivore`, modify the vision line to also apply fog:
```typescript
  const fogMul = state.weather.type === 'fog' ? 1 - state.weather.intensity * 0.6 : 1;
  const vision = h.traits.visionRange * dayMods.visionMul * fogMul;
```

Same in `steerPredator` and `steerScavenger`.

3. For wind drift, add after the position update in each update function (updateHerbivores, updatePredators, updateScavengers). After `h.pos.x += h.vel.x * dt * spdMul;` etc:
```typescript
    // Wind drift
    if (state.weather.type === 'wind') {
      const windForce = 15 * state.weather.intensity;
      h.pos.x += Math.cos(state.weather.windAngle) * windForce * dt;
      h.pos.y += Math.sin(state.weather.windAngle) * windForce * dt;
    }
```

Apply same pattern to predators and scavengers (using `p.pos` and `s.pos` respectively).

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/simulation.ts src/sim/agents.ts && git commit -m "feat: add weather gameplay effects (rain growth, fog vision, wind drift)"`

---

### Task 7: Weather — Visual Effects in Renderer

Rain: blue streak particles. Wind: visible drift lines. Fog: white semi-transparent overlay.

**Files:**
- Modify: `src/render/renderer.ts`

**Changes:**

1. Add a `weatherContainer` Graphics layer:
```typescript
  private weatherLayer: Graphics;
```

Initialize in constructor:
```typescript
    this.weatherLayer = new Graphics();
```

In `init()`, add AFTER the nightOverlay (or just before it — weather should render above creatures but below night):
```typescript
    this.app.stage.addChild(this.weatherLayer);
```
Actually, add it before nightOverlay so night darkens the weather too:
Move `this.app.stage.addChild(this.nightOverlay);` to be last, and add weatherLayer before it.

2. Add a `weatherEnabled` field:
```typescript
  private weatherEnabled: boolean = true;
```

Add method:
```typescript
  setWeather(enabled: boolean): void {
    this.weatherEnabled = enabled;
    if (!enabled) this.weatherLayer.clear();
  }
```

3. In `render()`, before the night overlay section, add weather rendering:
```typescript
    // === Weather visuals ===
    this.weatherLayer.clear();
    if (this.weatherEnabled && state.weather.type !== 'clear' && state.weather.intensity > 0.01) {
      const wi = state.weather.intensity;

      if (state.weather.type === 'rain') {
        // Blue streaks falling
        const rainCount = Math.floor(wi * 80);
        for (let i = 0; i < rainCount; i++) {
          const rx = ((i * 3571 + Math.floor(time * 200)) % this.worldW);
          const baseY = ((i * 7127 + Math.floor(time * 400)) % (this.worldH + 40)) - 20;
          this.weatherLayer
            .moveTo(rx, baseY)
            .lineTo(rx - 1, baseY + 12)
            .stroke({ color: 0x4466aa, width: 1, alpha: wi * 0.3 });
        }
        // Subtle blue tint overlay
        this.weatherLayer
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0x223355, alpha: wi * 0.06 });
      }

      if (state.weather.type === 'fog') {
        this.weatherLayer
          .rect(0, 0, this.worldW, this.worldH)
          .fill({ color: 0xcccccc, alpha: wi * 0.15 });
      }

      if (state.weather.type === 'wind') {
        const windAngle = state.weather.windAngle;
        const lineCount = Math.floor(wi * 30);
        const cos = Math.cos(windAngle);
        const sin = Math.sin(windAngle);
        for (let i = 0; i < lineCount; i++) {
          const bx = ((i * 4793 + Math.floor(time * 100 * cos)) % this.worldW);
          const by = ((i * 6151 + Math.floor(time * 100 * sin)) % this.worldH);
          const len = 15 + (i % 10) * 2;
          this.weatherLayer
            .moveTo(bx, by)
            .lineTo(bx + cos * len, by + sin * len)
            .stroke({ color: 0x8899aa, width: 1, alpha: wi * 0.15 });
        }
      }
    }
```

**Verify:** `npx tsc --noEmit`. Run dev server. Wait for weather events. Rain should show blue streaks, fog a white overlay, wind shows directional lines.

**Commit:** `git add src/render/renderer.ts && git commit -m "feat: add weather visual effects (rain streaks, fog overlay, wind lines)"`

---

### Task 8: Weather — UI Display & Toggle

Show weather in stats panel. Add "Weather" toggle in settings.

**Files:**
- Modify: `src/ui/overlay.ts` (stats display, settings toggle)
- Modify: `src/main.ts` (handle weather toggle)

**Changes:**

1. In `src/ui/overlay.ts`, in `updateStats()`, add after the Event line:
```typescript
      <div><span class="label">Weather:</span> <span class="value">${stats.weatherName}</span></div>
```

2. In `buildSettings()`, add "Weather" toggle in Display section after the Day/Night toggle:
```html
        <div class="setting-toggle-row">
          <label>Weather</label>
          <input type="checkbox" checked data-toggle="weather" />
        </div>
```

3. In `src/main.ts`, add handler in `handleConfigChange`:
```typescript
    if (key === 'weather') {
      this.renderer.setWeather(value as boolean);
      return;
    }
```

**Verify:** `npx tsc --noEmit`. Run dev server. Weather name should appear in stats. Toggle should hide visual effects.

**Commit:** `git add src/ui/overlay.ts src/main.ts && git commit -m "feat: add weather UI display and toggle"`

---

### Task 9: Weather Feed Events

Announce weather changes in the event feed.

**Files:**
- Modify: `src/sim/simulation.ts` (detect weather transitions in detectFeedEvents)

**Changes:**

In `detectFeedEvents()`, add weather detection. Track previous weather type:

1. Add a field to Simulation class:
```typescript
  private prevWeatherType: string = 'clear';
```

Reset it in `reset()`:
```typescript
    this.prevWeatherType = 'clear';
```

2. In `detectFeedEvents()`, add:
```typescript
    // Weather changes
    if (state.weather.type !== this.prevWeatherType) {
      if (state.weather.type !== 'clear') {
        const wName = state.weather.type.charAt(0).toUpperCase() + state.weather.type.slice(1);
        const weatherColors: Record<string, string> = { rain: '#4466aa', wind: '#8899aa', fog: '#aaaaaa' };
        feed.push({ time: t, text: `${wName} rolling in`, color: weatherColors[state.weather.type] || '#8899aa' });
      } else if (this.prevWeatherType !== 'clear') {
        feed.push({ time: t, text: 'Weather cleared', color: '#8899aa' });
      }
    }
    this.prevWeatherType = state.weather.type;
```

**Verify:** `npx tsc --noEmit`

**Commit:** `git add src/sim/simulation.ts && git commit -m "feat: add weather transition feed events"`

---

### Task 10: Final Build Verification

**Steps:**

1. `npx tsc --noEmit` — 0 errors
2. `npx vite build` — success
3. Visual check:
   - Day/night cycle visible (darkens at night, stars twinkle)
   - Creatures slow down / lose vision at night
   - Weather events occur (rain streaks, fog overlay, wind lines)
   - Rain boosts plant growth
   - Stats show Period and Weather
   - Toggles for Day/Night and Weather work
   - Feed announces weather changes
