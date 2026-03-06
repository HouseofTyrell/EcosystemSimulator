// Main simulation orchestrator
// Pure logic - no DOM, no rendering

import type { SimConfig, SimState, SimStats, Herbivore, Predator, Scavenger, Insect, Corpse, WeatherState, HerbivoreTraits, PredatorTraits, ScavengerTraits, InsectTraits, GenealogyEntry } from './types';
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
  createInsect,
  updateHerbivores,
  updatePredators,
  updateScavengers,
  updateInsects,
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
  insectHash: SpatialHash<Insect>;
  private diffusionAccum: number = 0;
  private readonly DIFFUSION_INTERVAL = 0.5; // seconds between diffusion
  private spawnQueues: { herb: SpawnQueue; pred: SpawnQueue; scav: SpawnQueue; insect: SpawnQueue };
  private prevHerbCount: number = 0;
  private prevPredCount: number = 0;
  private prevScavCount: number = 0;
  private prevInsectCount: number = 0;
  private milestones = new Set<string>();
  private prevWeatherType: string = 'clear';
  private prevLineageCounts: Map<number, number> = new Map();

  constructor(config?: Partial<SimConfig>) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.rng = new SeededRNG(fullConfig.seed);
    this.herbHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.predHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.scavHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.insectHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.herbHash.wrap = fullConfig.wrapWorld;
    this.predHash.wrap = fullConfig.wrapWorld;
    this.scavHash.wrap = fullConfig.wrapWorld;
    this.insectHash.wrap = fullConfig.wrapWorld;

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
      insects: [],
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
      insectTraitMemory: [],
      reintroductionTime: -Infinity,
      recentDeaths: new Map(),
      genealogy: new Map(),
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
      grazerCount: 0,
      foragerCount: 0,
      stalkerCount: 0,
      packHunterCount: 0,
      vultureCount: 0,
      beetleCount: 0,
      insectCount: 0,
      antCount: 0,
      beeCount: 0,
    };
  }

  private createSpawnQueues(config: SimConfig): { herb: SpawnQueue; pred: SpawnQueue; scav: SpawnQueue; insect: SpawnQueue } {
    return {
      herb: { remaining: config.initialHerbivores, interval: 3, timer: 0, startDelay: 3 },
      pred: { remaining: config.initialPredators, interval: 5, timer: 0, startDelay: 25 },
      scav: { remaining: config.initialScavengers, interval: 4, timer: 0, startDelay: 18 },
      insect: { remaining: config.initialInsects, interval: 2, timer: 0, startDelay: 5 },
    };
  }

  private spawnFromQueue(x: number, y: number, type: 'herbivore' | 'predator' | 'scavenger' | 'insect'): void {
    const state = this.state;
    const config = state.config;
    if (type === 'herbivore') {
      state.herbivores.push(createHerbivore(state.nextId++, x, y, this.rng, config));
    } else if (type === 'predator') {
      state.predators.push(createPredator(state.nextId++, x, y, this.rng, config));
    } else if (type === 'insect') {
      state.insects.push(createInsect(state.nextId++, x, y, this.rng, config));
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

    // Insects: spawn early alongside herbivores
    if (queues.insect.remaining > 0 && time >= queues.insect.startDelay) {
      queues.insect.timer += dt;
      if (queues.insect.timer >= queues.insect.interval) {
        queues.insect.timer -= queues.insect.interval;
        queues.insect.remaining--;
        const pos = this.findLandPosition();
        this.spawnFromQueue(pos.x, pos.y, 'insect');
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
    this.insectHash.clear();
    for (let i = 0; i < state.insects.length; i++) {
      if (state.insects[i].alive) {
        this.insectHash.insert(state.insects[i]);
      }
    }

    // Update agents
    const newHerbs = updateHerbivores(state, dt, this.herbHash, this.predHash, this.rng, state.events);
    const newPreds = updatePredators(state, dt, this.herbHash, this.predHash, this.rng, state.events, this.insectHash);
    const newScavs = updateScavengers(state, dt, this.scavHash, this.rng, state.events);
    const newInsects = updateInsects(state, dt, this.insectHash, this.predHash, this.rng, state.events);

    // Create corpses from dead creatures
    for (let i = 0; i < state.herbivores.length; i++) {
      const h = state.herbivores[i];
      if (!h.alive) {
        state.corpses.push({
          x: h.pos.x,
          y: h.pos.y,
          energy: Math.max(20, h.traits.size * 10 + Math.max(h.energy, 0) * 0.25),
          creatureType: 'herbivore',
          decayTimer: 30,
          maxDecay: 30,
        });
      }
    }
    for (let i = 0; i < state.predators.length; i++) {
      const p = state.predators[i];
      if (!p.alive) {
        state.corpses.push({
          x: p.pos.x,
          y: p.pos.y,
          energy: Math.max(20, p.traits.size * 10 + Math.max(p.energy, 0) * 0.25),
          creatureType: 'predator',
          decayTimer: 30,
          maxDecay: 30,
        });
      }
    }
    for (let i = 0; i < state.scavengers.length; i++) {
      const s = state.scavengers[i];
      if (!s.alive) {
        state.corpses.push({
          x: s.pos.x,
          y: s.pos.y,
          energy: Math.max(20, s.traits.size * 10 + Math.max(s.energy, 0) * 0.25),
          creatureType: 'scavenger',
          decayTimer: 30,
          maxDecay: 30,
        });
      }
    }
    for (let i = 0; i < state.insects.length; i++) {
      const ins = state.insects[i];
      if (!ins.alive) {
        state.corpses.push({
          x: ins.pos.x,
          y: ins.pos.y,
          energy: Math.max(3, ins.traits.size * 3),
          creatureType: 'insect',
          decayTimer: 8,
          maxDecay: 8,
        });
      }
    }

    // Capture death causes for inspector before removing
    state.recentDeaths.clear();
    for (const h of state.herbivores) if (!h.alive && h.deathCause) state.recentDeaths.set(h.id, h.deathCause);
    for (const p of state.predators) if (!p.alive && p.deathCause) state.recentDeaths.set(p.id, p.deathCause);
    for (const s of state.scavengers) if (!s.alive && s.deathCause) state.recentDeaths.set(s.id, s.deathCause);
    for (const ins of state.insects) if (!ins.alive && ins.deathCause) state.recentDeaths.set(ins.id, ins.deathCause);

    // Remove dead, add newborns
    state.herbivores = state.herbivores.filter(h => h.alive);
    state.predators = state.predators.filter(p => p.alive);
    state.scavengers = state.scavengers.filter(s => s.alive);
    state.insects = state.insects.filter(ins => ins.alive);
    state.herbivores.push(...newHerbs);
    state.predators.push(...newPreds);
    state.scavengers.push(...newScavs);
    state.insects.push(...newInsects);

    // Record genealogy for newborns
    const allNewborns = [...newHerbs, ...newPreds, ...newScavs, ...newInsects];
    for (const child of allNewborns) {
      state.genealogy.set(child.id, {
        id: child.id,
        parentId: child.parentId,
        type: child.type,
        generation: child.generation,
        birthTime: state.time,
      });
    }
    // Cap genealogy at 500 entries
    if (state.genealogy.size > 500) {
      const entries = Array.from(state.genealogy.keys());
      const toRemove = entries.length - 500;
      for (let i = 0; i < toRemove; i++) {
        state.genealogy.delete(entries[i]);
      }
    }

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
    if (state.predators.length === 0 && state.herbivores.length > 10 && this.rng.next() < 0.05) {
      const traits = avgTraits(state.predTraitMemory) as PredatorTraits | null;
      // Spawn as a cluster so they can find mates
      const cx = this.rng.range(100, config.worldWidth - 100);
      const cy = this.rng.range(100, config.worldHeight - 100);
      // Spawn 4 stalkers + 4 pack hunters in tight cluster
      for (let i = 0; i < 8; i++) {
        const sub = i < 4 ? 0 : 1;
        const p = createPredator(
          state.nextId++,
          cx + this.rng.range(-40, 40),
          cy + this.rng.range(-40, 40),
          this.rng,
          config,
          traits || undefined,
          sub
        );
        p.energy = config.predatorReproductionEnergy * 1.2;
        state.predators.push(p);
      }
      state.reintroductionTime = state.time;
    }
    if (state.scavengers.length === 0 && this.rng.next() < 0.03) {
      const traits = avgTraits(state.scavTraitMemory) as ScavengerTraits | null;
      const cx = this.rng.range(100, config.worldWidth - 100);
      const cy = this.rng.range(100, config.worldHeight - 100);
      for (let i = 0; i < 8; i++) {
        const s = createScavenger(
          state.nextId++,
          cx + this.rng.range(-40, 40),
          cy + this.rng.range(-40, 40),
          this.rng,
          config,
          traits || undefined
        );
        s.energy = config.scavengerReproductionEnergy * 1.2;
        state.scavengers.push(s);
      }
      state.reintroductionTime = state.time;
    }
    if (state.insects.length === 0 && this.rng.next() < 0.04) {
      const traits = avgTraits(state.insectTraitMemory) as InsectTraits | null;
      const cx = this.rng.range(100, config.worldWidth - 100);
      const cy = this.rng.range(100, config.worldHeight - 100);
      for (let i = 0; i < 20; i++) {
        const sub = i < 10 ? 0 : 1;
        const ins = createInsect(
          state.nextId++,
          cx + this.rng.range(-60, 60),
          cy + this.rng.range(-60, 60),
          this.rng,
          config,
          traits || undefined,
          sub
        );
        ins.energy = config.insectReproductionEnergy * 1.2;
        state.insects.push(ins);
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

    // Insect stats
    const insects = state.insects;
    stats.insectCount = insects.length;
    let antCount = 0, beeCount = 0;
    for (const ins of insects) {
      if (ins.subspecies === 0) antCount++; else beeCount++;
    }
    stats.antCount = antCount;
    stats.beeCount = beeCount;

    // Lineage population counts and max generation
    state.lineageCounts.clear();
    let maxGen = 0;
    const allCreatures = [...herbs, ...preds, ...scavs, ...insects];
    for (let i = 0; i < allCreatures.length; i++) {
      const c = allCreatures[i];
      state.lineageCounts.set(c.lineageId, (state.lineageCounts.get(c.lineageId) || 0) + 1);
      if (c.generation > maxGen) maxGen = c.generation;
    }
    stats.maxGeneration = maxGen;

    let grazerCount = 0, foragerCount = 0;
    for (const h of herbs) {
      if (h.subspecies === 0) grazerCount++; else foragerCount++;
    }
    stats.grazerCount = grazerCount;
    stats.foragerCount = foragerCount;

    let stalkerCount = 0, packHunterCount = 0;
    for (const p of preds) {
      if (p.subspecies === 0) stalkerCount++; else packHunterCount++;
    }
    stats.stalkerCount = stalkerCount;
    stats.packHunterCount = packHunterCount;

    let vultureCount = 0, beetleCount = 0;
    for (const s of scavs) {
      if (s.subspecies === 0) vultureCount++; else beetleCount++;
    }
    stats.vultureCount = vultureCount;
    stats.beetleCount = beetleCount;
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
      { name: 'Insects', count: state.insects.length, prev: this.prevInsectCount, color: '#bb8822' },
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
    this.prevInsectCount = state.insects.length;

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

    // Lineage milestones (only major ones to reduce feed spam)
    for (const [lid, count] of state.lineageCounts) {
      const prev = this.prevLineageCounts.get(lid) || 0;
      if (count >= 25 && prev < 25) {
        feed.push({ time: t, text: `Line #${lid} flourishing (${count})`, color: '#ccddee' });
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

  paintTerrain(cells: { col: number; row: number; terrain: number }[]): void {
    const state = this.state;
    const cols = state.config.plantGridCols;
    const rows = state.config.plantGridRows;
    for (const cell of cells) {
      if (cell.col >= 0 && cell.col < cols && cell.row >= 0 && cell.row < rows) {
        const idx = cell.row * cols + cell.col;
        state.terrain[idx] = cell.terrain;
        // Water kills plants, fertile boosts them, mountain kills them
        if (cell.terrain === TerrainType.Water || cell.terrain === TerrainType.Mountain) {
          state.plantGrid[idx] = 0;
        } else if (cell.terrain === TerrainType.Fertile) {
          // Boost soil health for fertile terrain
          state.soilHealth[idx] = Math.min(state.soilHealth[idx] + 0.3, 1.5);
        }
      }
    }
  }

  spawnCreatures(creatureType: 'herbivore' | 'predator' | 'scavenger' | 'insect', x: number, y: number, count: number): void {
    const state = this.state;
    const config = state.config;
    for (let i = 0; i < count; i++) {
      const offsetX = count > 1 ? this.rng.range(-30, 30) : 0;
      const offsetY = count > 1 ? this.rng.range(-30, 30) : 0;
      const sx = Math.max(0, Math.min(config.worldWidth, x + offsetX));
      const sy = Math.max(0, Math.min(config.worldHeight, y + offsetY));
      if (creatureType === 'herbivore') {
        state.herbivores.push(createHerbivore(state.nextId++, sx, sy, this.rng, config));
      } else if (creatureType === 'predator') {
        state.predators.push(createPredator(state.nextId++, sx, sy, this.rng, config));
      } else if (creatureType === 'scavenger') {
        state.scavengers.push(createScavenger(state.nextId++, sx, sy, this.rng, config));
      } else {
        state.insects.push(createInsect(state.nextId++, sx, sy, this.rng, config));
      }
    }
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
      insects: [],
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
      insectTraitMemory: [],
      reintroductionTime: -Infinity,
      recentDeaths: new Map(),
      genealogy: new Map(),
    };
    this.herbHash.wrap = config.wrapWorld;
    this.predHash.wrap = config.wrapWorld;
    this.scavHash.wrap = config.wrapWorld;
    this.insectHash.wrap = config.wrapWorld;
    this.diffusionAccum = 0;
    this.spawnQueues = this.createSpawnQueues(config);
    this.prevHerbCount = 0;
    this.prevPredCount = 0;
    this.prevScavCount = 0;
    this.prevInsectCount = 0;
    this.milestones.clear();
    this.prevWeatherType = 'clear';
    this.prevLineageCounts.clear();
  }

  /** Serialize full simulation state to a plain object for JSON export. */
  serialize(): object {
    const state = this.state;

    function serializeCreature(c: Herbivore | Predator | Scavenger | Insect): object {
      const base: Record<string, unknown> = {
        type: c.type,
        id: c.id,
        parentId: c.parentId,
        pos: c.pos,
        vel: c.vel,
        energy: c.energy,
        age: c.age,
        maxAge: c.maxAge,
        reproductionCooldown: c.reproductionCooldown,
        alive: c.alive,
        lineageId: c.lineageId,
        generation: c.generation,
        behavior: c.behavior,
        stamina: c.stamina,
        exhausted: c.exhausted,
        lastThreatPos: c.lastThreatPos,
        threatTimer: c.threatTimer,
        offspringCount: c.offspringCount,
        deathCause: c.deathCause,
        infected: c.infected,
        subspecies: c.subspecies,
        birthPos: c.birthPos,
        homeBase: c.homeBase,
        traits: c.traits,
        // Memory: serialize typed arrays
        memory: c.memory ? {
          foodQuality: Array.from(c.memory.foodQuality),
          dangerLevel: Array.from(c.memory.dangerLevel),
          lastVisited: Array.from(c.memory.lastVisited),
        } : null,
      };
      if (c.type === 'predator') {
        base.attackTimer = (c as Predator).attackTimer;
      }
      return base;
    }

    return {
      version: 1,
      config: { ...state.config },
      time: state.time,
      season: state.season,
      seasonalMultiplier: state.seasonalMultiplier,
      dayPhase: state.dayPhase,
      timeOfDay: state.timeOfDay,
      nextId: state.nextId,
      eventCooldown: state.eventCooldown,
      weatherCooldown: state.weatherCooldown,
      reintroductionTime: state.reintroductionTime,
      weather: { ...state.weather },
      activeEvent: state.activeEvent ? { ...state.activeEvent } : null,
      plantGrid: Array.from(state.plantGrid),
      terrain: Array.from(state.terrain),
      soilHealth: Array.from(state.soilHealth),
      herbivores: state.herbivores.map(serializeCreature),
      predators: state.predators.map(serializeCreature),
      scavengers: state.scavengers.map(serializeCreature),
      insects: state.insects.map(serializeCreature),
      corpses: state.corpses,
      herbTraitMemory: state.herbTraitMemory,
      predTraitMemory: state.predTraitMemory,
      scavTraitMemory: state.scavTraitMemory,
      insectTraitMemory: state.insectTraitMemory,
      genealogy: Array.from(state.genealogy.entries()),
      rngState: this.rng.getState(),
    };
  }

  /** Restore simulation state from a deserialized object. */
  deserialize(data: Record<string, unknown>): void {
    const d = data as Record<string, any>;
    const config = d.config as SimConfig;

    function deserializeCreature(raw: any): any {
      const c = { ...raw };
      if (c.memory) {
        c.memory = {
          foodQuality: Float32Array.from(c.memory.foodQuality),
          dangerLevel: Float32Array.from(c.memory.dangerLevel),
          lastVisited: Float32Array.from(c.memory.lastVisited),
        };
      }
      // Ensure parentId exists (backward compat)
      if (c.parentId === undefined) c.parentId = null;
      return c;
    }

    this.rng = new SeededRNG(config.seed);
    if (d.rngState !== undefined) {
      this.rng.setState(d.rngState);
    }

    this.state = {
      config,
      time: d.time,
      season: d.season,
      seasonalMultiplier: d.seasonalMultiplier,
      dayPhase: d.dayPhase,
      timeOfDay: d.timeOfDay,
      plantGrid: Float32Array.from(d.plantGrid),
      terrain: Uint8Array.from(d.terrain),
      soilHealth: d.soilHealth ? Float32Array.from(d.soilHealth) : new Float32Array(config.plantGridCols * config.plantGridRows).fill(1.0),
      herbivores: (d.herbivores as any[]).map(deserializeCreature),
      predators: (d.predators as any[]).map(deserializeCreature),
      scavengers: (d.scavengers as any[]).map(deserializeCreature),
      insects: (d.insects as any[]).map(deserializeCreature),
      corpses: d.corpses || [],
      nextId: d.nextId,
      stats: this.emptyStats(),
      events: [],
      activeEvent: d.activeEvent || null,
      eventCooldown: d.eventCooldown ?? 30,
      feedEvents: [],
      weather: d.weather || { type: 'clear', intensity: 0, duration: 0, remaining: 0, windAngle: 0 },
      weatherCooldown: d.weatherCooldown ?? 60,
      lineageCounts: new Map(),
      herbTraitMemory: d.herbTraitMemory || [],
      predTraitMemory: d.predTraitMemory || [],
      scavTraitMemory: d.scavTraitMemory || [],
      insectTraitMemory: d.insectTraitMemory || [],
      reintroductionTime: d.reintroductionTime ?? -Infinity,
      recentDeaths: new Map(),
      genealogy: d.genealogy ? new Map(d.genealogy) : new Map(),
    };

    // Rebuild spatial hashes
    this.herbHash = new SpatialHash(config.worldWidth, config.worldHeight, config.spatialCellSize);
    this.predHash = new SpatialHash(config.worldWidth, config.worldHeight, config.spatialCellSize);
    this.scavHash = new SpatialHash(config.worldWidth, config.worldHeight, config.spatialCellSize);
    this.insectHash = new SpatialHash(config.worldWidth, config.worldHeight, config.spatialCellSize);
    this.herbHash.wrap = config.wrapWorld;
    this.predHash.wrap = config.wrapWorld;
    this.scavHash.wrap = config.wrapWorld;
    this.insectHash.wrap = config.wrapWorld;
    this.diffusionAccum = 0;
    this.spawnQueues = { herb: { remaining: 0, interval: 3, timer: 0, startDelay: 0 }, pred: { remaining: 0, interval: 5, timer: 0, startDelay: 0 }, scav: { remaining: 0, interval: 4, timer: 0, startDelay: 0 }, insect: { remaining: 0, interval: 2, timer: 0, startDelay: 0 } };
    this.prevHerbCount = this.state.herbivores.length;
    this.prevPredCount = this.state.predators.length;
    this.prevScavCount = this.state.scavengers.length;
    this.prevInsectCount = this.state.insects.length;
    this.milestones.clear();
    this.prevWeatherType = this.state.weather.type;
    this.prevLineageCounts.clear();
    this.computeStats();
  }
}
