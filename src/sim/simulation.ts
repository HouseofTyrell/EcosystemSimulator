// Main simulation orchestrator
// Pure logic - no DOM, no rendering

import type { SimConfig, SimState, SimStats, Herbivore, Predator, Scavenger, Corpse } from './types';
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

  step(dt: number): void {
    const state = this.state;
    const config = state.config;

    state.events.length = 0;
    state.time += dt;
    state.season = (state.time / config.seasonPeriod) % 1;
    state.seasonalMultiplier = getSeasonalMultiplier(state.time, config);

    // Gradual initial spawning
    this.updateSpawnQueues(dt);

    // Update environmental events
    updateEvents(state, dt, this.rng);

    // Update plants
    const eventMult = getEventPlantMultiplier(state);
    updatePlants(state.plantGrid, dt, state.seasonalMultiplier * eventMult, config, state.terrain);

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
          energy: 20,
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
          energy: 25,
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
          energy: 15,
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

    // Extinction recovery: if herbivores die out, slowly reintroduce
    if (state.herbivores.length === 0 && this.rng.next() < 0.02) {
      for (let i = 0; i < 5; i++) {
        state.herbivores.push(
          createHerbivore(
            state.nextId++,
            this.rng.range(0, config.worldWidth),
            this.rng.range(0, config.worldHeight),
            this.rng,
            config
          )
        );
      }
    }
    if (state.predators.length === 0 && state.herbivores.length > 20 && this.rng.next() < 0.01) {
      for (let i = 0; i < 2; i++) {
        state.predators.push(
          createPredator(
            state.nextId++,
            this.rng.range(0, config.worldWidth),
            this.rng.range(0, config.worldHeight),
            this.rng,
            config
          )
        );
      }
    }
    if (state.scavengers.length === 0 && state.corpses.length > 3 && this.rng.next() < 0.01) {
      for (let i = 0; i < 3; i++) {
        state.scavengers.push(
          createScavenger(
            state.nextId++,
            this.rng.range(0, config.worldWidth),
            this.rng.range(0, config.worldHeight),
            this.rng,
            config
          )
        );
      }
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
  }
}
