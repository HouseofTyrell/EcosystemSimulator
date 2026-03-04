// Main simulation orchestrator
// Pure logic - no DOM, no rendering

import type { SimConfig, SimState, SimStats, Herbivore, Predator, Scavenger, Corpse, WeatherState, HerbivoreTraits, PredatorTraits, ScavengerTraits } from './types';
import { DEFAULT_CONFIG, TerrainType } from './types';
import { SeededRNG } from './rng';
import { SpatialHash } from './spatial';
import {
  createPlantGrid,
  updatePlants,
  diffusePlants,
  getSeasonalMultiplier,
  getSeasonName,
} from './plants';
import {
  createHerbivore,
  createPredator,
  createScavenger,
  updateHerbivores,
  updatePredators,
  updateScavengers,
} from './agents';
import { generateTerrain, getTerrainAt } from './terrain';
import { updateEvents, getEventPlantMultiplier } from './events';

/** Average trait snapshots for adaptive reintroduction. Returns null if no memory. */
function avgTraits<T extends object>(memory: T[]): T | null {
  if (memory.length === 0) return null;
  const result = { ...memory[0] };
  for (const key of Object.keys(result) as (keyof T & string)[]) {
    let sum = 0;
    for (let i = 0; i < memory.length; i++) {
      sum += memory[i][key] as number;
    }
    (result as Record<string, number>)[key] = sum / memory.length;
  }
  return result;
}

interface SpawnQueue {
  remaining: number;
  interval: number;  // seconds between spawns
  timer: number;
  startDelay: number; // seconds before first spawn
}

export class Simulation {
  state: SimState;
  rng: SeededRNG;
  herbHash: SpatialHash<Herbivore>;
  predHash: SpatialHash<Predator>;
  scavHash: SpatialHash<Scavenger>;
  private diffusionAccum: number = 0;
  private readonly DIFFUSION_INTERVAL = 0.5; // seconds between diffusion
  private spawnQueues: { herb: SpawnQueue; pred: SpawnQueue; scav: SpawnQueue };
  private prevHerbCount: number = 0;
  private prevPredCount: number = 0;
  private prevScavCount: number = 0;
  private milestones = new Set<string>();
  private prevWeatherType: string = 'clear';
  private prevLineageCounts: Map<number, number> = new Map();

  constructor(config?: Partial<SimConfig>) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.rng = new SeededRNG(fullConfig.seed);
    this.herbHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.predHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.scavHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.herbHash.wrap = fullConfig.wrapWorld;
    this.predHash.wrap = fullConfig.wrapWorld;
    this.scavHash.wrap = fullConfig.wrapWorld;

    this.state = {
      config: fullConfig,
      time: 0,
      season: 0,
      seasonalMultiplier: 1,
      dayPhase: 0,
      timeOfDay: 'Dawn',
      plantGrid: createPlantGrid(fullConfig),
      terrain: generateTerrain(fullConfig, fullConfig.seed),
      herbivores: [],
      predators: [],
      scavengers: [],
      corpses: [],
      nextId: 0,
      stats: this.emptyStats(),
      events: [],
      activeEvent: null,
      eventCooldown: 30,
      feedEvents: [],
      weather: { type: 'clear', intensity: 0, duration: 0, remaining: 0, windAngle: 0 },
      weatherCooldown: 60,
      lineageCounts: new Map(),
      soilHealth: new Float32Array(fullConfig.plantGridCols * fullConfig.plantGridRows).fill(1.0),
      herbTraitMemory: [],
      predTraitMemory: [],
      scavTraitMemory: [],
      reintroductionTime: -Infinity,
    };

    this.spawnQueues = this.createSpawnQueues(fullConfig);
  }

  private emptyStats(): SimStats {
    return {
      herbivoreCount: 0,
      predatorCount: 0,
      plantDensity: 0,
      avgHerbivoreSpeed: 0,
      avgHerbivoreSize: 0,
      avgHerbivoreVision: 0,
      avgPredatorSpeed: 0,
      avgPredatorSize: 0,
      avgPredatorVision: 0,
      scavengerCount: 0,
      avgScavengerSpeed: 0,
      avgScavengerSize: 0,
      seasonName: 'Spring',
      activeEventName: '',
      timeOfDay: 'Dawn',
      weatherName: 'Clear',
      maxGeneration: 0,
    };
  }

  private createSpawnQueues(config: SimConfig): { herb: SpawnQueue; pred: SpawnQueue; scav: SpawnQueue } {
    return {
      herb: { remaining: config.initialHerbivores, interval: 3, timer: 0, startDelay: 3 },
      pred: { remaining: config.initialPredators, interval: 5, timer: 0, startDelay: 25 },
      scav: { remaining: config.initialScavengers, interval: 4, timer: 0, startDelay: 18 },
    };
  }

  private spawnFromQueue(x: number, y: number, type: 'herbivore' | 'predator' | 'scavenger'): void {
    const state = this.state;
    const config = state.config;
    if (type === 'herbivore') {
      state.herbivores.push(createHerbivore(state.nextId++, x, y, this.rng, config));
    } else if (type === 'predator') {
      state.predators.push(createPredator(state.nextId++, x, y, this.rng, config));
    } else {
      state.scavengers.push(createScavenger(state.nextId++, x, y, this.rng, config));
    }
    state.events.push({ type: 'birth', creatureType: type, x, y });
  }

  private findLandPosition(): { x: number; y: number } {
    const config = this.state.config;
    let x: number, y: number;
    do {
      x = this.rng.range(0, config.worldWidth);
      y = this.rng.range(0, config.worldHeight);
    } while (
      getTerrainAt(this.state.terrain, x, y, config) === TerrainType.Water ||
      getTerrainAt(this.state.terrain, x, y, config) === TerrainType.Mountain
    );
    return { x, y };
  }

  private updateSpawnQueues(dt: number): void {
    const time = this.state.time;
    const queues = this.spawnQueues;

    // Herbivores: spawn first, need plants to eat
    if (queues.herb.remaining > 0 && time >= queues.herb.startDelay) {
      queues.herb.timer += dt;
      if (queues.herb.timer >= queues.herb.interval) {
        queues.herb.timer -= queues.herb.interval;
        queues.herb.remaining--;
        const pos = this.findLandPosition();
        this.spawnFromQueue(pos.x, pos.y, 'herbivore');
      }
    }

    // Predators: spawn after delay so herbivores establish first
    if (queues.pred.remaining > 0 && time >= queues.pred.startDelay) {
      queues.pred.timer += dt;
      if (queues.pred.timer >= queues.pred.interval) {
        queues.pred.timer -= queues.pred.interval;
        queues.pred.remaining--;
        const pos = this.findLandPosition();
        this.spawnFromQueue(pos.x, pos.y, 'predator');
      }
    }

    // Scavengers: spawn after some deaths have occurred
    if (queues.scav.remaining > 0 && time >= queues.scav.startDelay) {
      queues.scav.timer += dt;
      if (queues.scav.timer >= queues.scav.interval) {
        queues.scav.timer -= queues.scav.interval;
        queues.scav.remaining--;
        const pos = this.findLandPosition();
        this.spawnFromQueue(pos.x, pos.y, 'scavenger');
      }
    }
  }

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

  step(dt: number): void {
    const state = this.state;
    const config = state.config;

    state.events.length = 0;
    state.time += dt;
    state.season = (state.time / config.seasonPeriod) % 1;
    state.seasonalMultiplier = getSeasonalMultiplier(state.time, config);

    // Day/night cycle
    state.dayPhase = (state.time / config.dayNightPeriod) % 1;
    if (state.dayPhase < 0.25) state.timeOfDay = 'Dawn';
    else if (state.dayPhase < 0.5) state.timeOfDay = 'Day';
    else if (state.dayPhase < 0.75) state.timeOfDay = 'Dusk';
    else state.timeOfDay = 'Night';

    // Gradual initial spawning
    this.updateSpawnQueues(dt);

    // Update environmental events
    updateEvents(state, dt, this.rng);

    // Update weather
    this.updateWeather(dt);

    // Update plants
    const eventMult = getEventPlantMultiplier(state);
    const weatherPlantMul = state.weather.type === 'rain' ? 1 + 0.5 * state.weather.intensity : 1;
    updatePlants(state.plantGrid, dt, state.seasonalMultiplier * eventMult * weatherPlantMul, config, state.terrain, state.soilHealth);

    // Diffusion (periodic)
    this.diffusionAccum += dt;
    if (this.diffusionAccum >= this.DIFFUSION_INTERVAL) {
      diffusePlants(state.plantGrid, config);
      this.diffusionAccum -= this.DIFFUSION_INTERVAL;
    }

    // Rebuild spatial hashes
    this.herbHash.clear();
    for (let i = 0; i < state.herbivores.length; i++) {
      if (state.herbivores[i].alive) {
        this.herbHash.insert(state.herbivores[i]);
      }
    }
    this.predHash.clear();
    for (let i = 0; i < state.predators.length; i++) {
      if (state.predators[i].alive) {
        this.predHash.insert(state.predators[i]);
      }
    }
    this.scavHash.clear();
    for (let i = 0; i < state.scavengers.length; i++) {
      if (state.scavengers[i].alive) {
        this.scavHash.insert(state.scavengers[i]);
      }
    }

    // Update agents
    const newHerbs = updateHerbivores(state, dt, this.herbHash, this.predHash, this.rng, state.events);
    const newPreds = updatePredators(state, dt, this.herbHash, this.predHash, this.rng, state.events);
    const newScavs = updateScavengers(state, dt, this.scavHash, this.rng, state.events);

    // Create corpses from dead creatures
    for (let i = 0; i < state.herbivores.length; i++) {
      const h = state.herbivores[i];
      if (!h.alive) {
        state.corpses.push({
          x: h.pos.x,
          y: h.pos.y,
          energy: Math.max(10, h.traits.size * Math.max(h.energy, 5) * 0.15),
          creatureType: 'herbivore',
          decayTimer: 15,
          maxDecay: 15,
        });
      }
    }
    for (let i = 0; i < state.predators.length; i++) {
      const p = state.predators[i];
      if (!p.alive) {
        state.corpses.push({
          x: p.pos.x,
          y: p.pos.y,
          energy: Math.max(10, p.traits.size * Math.max(p.energy, 5) * 0.15),
          creatureType: 'predator',
          decayTimer: 15,
          maxDecay: 15,
        });
      }
    }
    for (let i = 0; i < state.scavengers.length; i++) {
      const s = state.scavengers[i];
      if (!s.alive) {
        state.corpses.push({
          x: s.pos.x,
          y: s.pos.y,
          energy: Math.max(10, s.traits.size * Math.max(s.energy, 5) * 0.15),
          creatureType: 'scavenger',
          decayTimer: 15,
          maxDecay: 15,
        });
      }
    }

    // Remove dead, add newborns
    state.herbivores = state.herbivores.filter(h => h.alive);
    state.predators = state.predators.filter(p => p.alive);
    state.scavengers = state.scavengers.filter(s => s.alive);
    state.herbivores.push(...newHerbs);
    state.predators.push(...newPreds);
    state.scavengers.push(...newScavs);

    // Extinction recovery: adaptive reintroduction with trait memory
    if (state.herbivores.length === 0 && this.rng.next() < 0.02) {
      const traits = avgTraits(state.herbTraitMemory) as HerbivoreTraits | null;
      for (let i = 0; i < 15; i++) {
        const h = createHerbivore(
          state.nextId++,
          this.rng.range(0, config.worldWidth),
          this.rng.range(0, config.worldHeight),
          this.rng,
          config,
          traits || undefined
        );
        h.energy = config.herbivoreReproductionEnergy;
        state.herbivores.push(h);
      }
      state.reintroductionTime = state.time;
    }
    if (state.predators.length === 0 && state.herbivores.length > 10 && this.rng.next() < 0.01) {
      const traits = avgTraits(state.predTraitMemory) as PredatorTraits | null;
      for (let i = 0; i < 6; i++) {
        const p = createPredator(
          state.nextId++,
          this.rng.range(0, config.worldWidth),
          this.rng.range(0, config.worldHeight),
          this.rng,
          config,
          traits || undefined
        );
        p.energy = config.predatorReproductionEnergy;
        state.predators.push(p);
      }
      state.reintroductionTime = state.time;
    }
    if (state.scavengers.length === 0 && state.corpses.length > 2 && this.rng.next() < 0.01) {
      const traits = avgTraits(state.scavTraitMemory) as ScavengerTraits | null;
      for (let i = 0; i < 8; i++) {
        const s = createScavenger(
          state.nextId++,
          this.rng.range(0, config.worldWidth),
          this.rng.range(0, config.worldHeight),
          this.rng,
          config,
          traits || undefined
        );
        s.energy = config.scavengerReproductionEnergy;
        state.scavengers.push(s);
      }
      state.reintroductionTime = state.time;
    }

    // Decay corpses
    for (let i = state.corpses.length - 1; i >= 0; i--) {
      state.corpses[i].decayTimer -= dt;
      if (state.corpses[i].decayTimer <= 0 || state.corpses[i].energy <= 0) {
        state.corpses.splice(i, 1);
      }
    }

    // Update stats
    this.computeStats();

    // Detect feed events
    this.detectFeedEvents();
  }

  private computeStats(): void {
    const state = this.state;
    const stats = state.stats;
    const herbs = state.herbivores;
    const preds = state.predators;

    stats.herbivoreCount = herbs.length;
    stats.predatorCount = preds.length;
    stats.seasonName = getSeasonName(state.time, state.config);
    stats.activeEventName = state.activeEvent ? state.activeEvent.type : 'none';
    stats.timeOfDay = state.timeOfDay;
    stats.weatherName = state.weather.type === 'clear' ? 'Clear' :
      state.weather.type.charAt(0).toUpperCase() + state.weather.type.slice(1);

    // Plant density (average)
    let totalPlant = 0;
    for (let i = 0; i < state.plantGrid.length; i++) {
      totalPlant += state.plantGrid[i];
    }
    stats.plantDensity = totalPlant / state.plantGrid.length;

    // Avg herbivore traits
    if (herbs.length > 0) {
      let spdSum = 0, sizeSum = 0, visSum = 0;
      for (let i = 0; i < herbs.length; i++) {
        spdSum += herbs[i].traits.speed;
        sizeSum += herbs[i].traits.size;
        visSum += herbs[i].traits.visionRange;
      }
      stats.avgHerbivoreSpeed = spdSum / herbs.length;
      stats.avgHerbivoreSize = sizeSum / herbs.length;
      stats.avgHerbivoreVision = visSum / herbs.length;
    }

    // Avg predator traits
    if (preds.length > 0) {
      let spdSum = 0, sizeSum = 0, visSum = 0;
      for (let i = 0; i < preds.length; i++) {
        spdSum += preds[i].traits.speed;
        sizeSum += preds[i].traits.size;
        visSum += preds[i].traits.visionRange;
      }
      stats.avgPredatorSpeed = spdSum / preds.length;
      stats.avgPredatorSize = sizeSum / preds.length;
      stats.avgPredatorVision = visSum / preds.length;
    }

    // Scavenger stats
    const scavs = state.scavengers;
    stats.scavengerCount = scavs.length;
    if (scavs.length > 0) {
      let spdSum = 0, sizeSum = 0;
      for (let i = 0; i < scavs.length; i++) {
        spdSum += scavs[i].traits.speed;
        sizeSum += scavs[i].traits.size;
      }
      stats.avgScavengerSpeed = spdSum / scavs.length;
      stats.avgScavengerSize = sizeSum / scavs.length;
    }

    // Lineage population counts and max generation
    state.lineageCounts.clear();
    let maxGen = 0;
    const allCreatures = [...herbs, ...preds, ...scavs];
    for (let i = 0; i < allCreatures.length; i++) {
      const c = allCreatures[i];
      state.lineageCounts.set(c.lineageId, (state.lineageCounts.get(c.lineageId) || 0) + 1);
      if (c.generation > maxGen) maxGen = c.generation;
    }
    stats.maxGeneration = maxGen;
  }

  private detectFeedEvents(): void {
    const state = this.state;
    const t = state.time;
    const feed = state.feedEvents;

    // Environmental events (detect start)
    if (state.activeEvent && state.activeEvent.remaining >= state.activeEvent.duration - 0.02) {
      const name = state.activeEvent.type.charAt(0).toUpperCase() + state.activeEvent.type.slice(1);
      const eventColors: Record<string, string> = { drought: '#cc8844', bloom: '#44cc66', disease: '#cc44cc' };
      feed.push({ time: t, text: `${name} began`, color: eventColors[state.activeEvent.type] || '#8899aa' });
    }

    // Extinction / Recovery / Milestones
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

    // Lineage milestones
    for (const [lid, count] of state.lineageCounts) {
      const prev = this.prevLineageCounts.get(lid) || 0;
      if (count >= 5 && prev < 5) {
        feed.push({ time: t, text: `Line #${lid} dominant (${count})`, color: '#aabbcc' });
      }
      if (count >= 10 && prev < 10) {
        feed.push({ time: t, text: `Line #${lid} thriving (${count})`, color: '#ccddee' });
      }
    }
    // Lineage endings
    for (const [lid, prev] of this.prevLineageCounts) {
      if (prev > 0 && (!state.lineageCounts.has(lid) || state.lineageCounts.get(lid) === 0)) {
        if (prev >= 3) {
          feed.push({ time: t, text: `Line #${lid} ended`, color: '#667788' });
        }
      }
    }
    this.prevLineageCounts = new Map(state.lineageCounts);
  }

  reset(seed?: number): void {
    const config = { ...this.state.config };
    if (seed !== undefined) {
      config.seed = seed;
    }
    this.rng = new SeededRNG(config.seed);
    this.state = {
      config,
      time: 0,
      season: 0,
      seasonalMultiplier: 1,
      dayPhase: 0,
      timeOfDay: 'Dawn',
      plantGrid: createPlantGrid(config),
      terrain: generateTerrain(config, config.seed),
      herbivores: [],
      predators: [],
      scavengers: [],
      corpses: [],
      nextId: 0,
      stats: this.emptyStats(),
      events: [],
      activeEvent: null,
      eventCooldown: 30,
      feedEvents: [],
      weather: { type: 'clear', intensity: 0, duration: 0, remaining: 0, windAngle: 0 },
      weatherCooldown: 60,
      lineageCounts: new Map(),
      soilHealth: new Float32Array(config.plantGridCols * config.plantGridRows).fill(1.0),
      herbTraitMemory: [],
      predTraitMemory: [],
      scavTraitMemory: [],
      reintroductionTime: -Infinity,
    };
    this.herbHash.wrap = config.wrapWorld;
    this.predHash.wrap = config.wrapWorld;
    this.scavHash.wrap = config.wrapWorld;
    this.diffusionAccum = 0;
    this.spawnQueues = this.createSpawnQueues(config);
    this.prevHerbCount = 0;
    this.prevPredCount = 0;
    this.prevScavCount = 0;
    this.milestones.clear();
    this.prevWeatherType = 'clear';
    this.prevLineageCounts.clear();
  }
}
