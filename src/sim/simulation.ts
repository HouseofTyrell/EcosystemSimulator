// Main simulation orchestrator
// Pure logic - no DOM, no rendering

import type { SimConfig, SimState, SimStats, Herbivore, Predator } from './types';
import { DEFAULT_CONFIG } from './types';
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
  updateHerbivores,
  updatePredators,
} from './agents';

export class Simulation {
  state: SimState;
  rng: SeededRNG;
  herbHash: SpatialHash<Herbivore>;
  predHash: SpatialHash<Predator>;
  private diffusionAccum: number = 0;
  private readonly DIFFUSION_INTERVAL = 0.5; // seconds between diffusion

  constructor(config?: Partial<SimConfig>) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.rng = new SeededRNG(fullConfig.seed);
    this.herbHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);
    this.predHash = new SpatialHash(fullConfig.worldWidth, fullConfig.worldHeight, fullConfig.spatialCellSize);

    this.state = {
      config: fullConfig,
      time: 0,
      season: 0,
      seasonalMultiplier: 1,
      plantGrid: createPlantGrid(fullConfig),
      herbivores: [],
      predators: [],
      nextId: 0,
      stats: this.emptyStats(),
      events: [],
    };

    this.spawnInitialPopulation();
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
      seasonName: 'Spring',
    };
  }

  private spawnInitialPopulation(): void {
    const config = this.state.config;

    for (let i = 0; i < config.initialHerbivores; i++) {
      const h = createHerbivore(
        this.state.nextId++,
        this.rng.range(0, config.worldWidth),
        this.rng.range(0, config.worldHeight),
        this.rng,
        config
      );
      this.state.herbivores.push(h);
    }

    for (let i = 0; i < config.initialPredators; i++) {
      const p = createPredator(
        this.state.nextId++,
        this.rng.range(0, config.worldWidth),
        this.rng.range(0, config.worldHeight),
        this.rng,
        config
      );
      this.state.predators.push(p);
    }
  }

  step(dt: number): void {
    const state = this.state;
    const config = state.config;

    state.events.length = 0;
    state.time += dt;
    state.season = (state.time / config.seasonPeriod) % 1;
    state.seasonalMultiplier = getSeasonalMultiplier(state.time, config);

    // Update plants
    updatePlants(state.plantGrid, dt, state.seasonalMultiplier, config);

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

    // Update agents
    const newHerbs = updateHerbivores(state, dt, this.herbHash, this.predHash, this.rng, state.events);
    const newPreds = updatePredators(state, dt, this.herbHash, this.predHash, this.rng, state.events);

    // Remove dead, add newborns
    state.herbivores = state.herbivores.filter(h => h.alive);
    state.predators = state.predators.filter(p => p.alive);
    state.herbivores.push(...newHerbs);
    state.predators.push(...newPreds);

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

    // Update stats
    this.computeStats();
  }

  private computeStats(): void {
    const state = this.state;
    const stats = state.stats;
    const herbs = state.herbivores;
    const preds = state.predators;

    stats.herbivoreCount = herbs.length;
    stats.predatorCount = preds.length;
    stats.seasonName = getSeasonName(state.time, state.config);

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
      herbivores: [],
      predators: [],
      nextId: 0,
      stats: this.emptyStats(),
      events: [],
    };
    this.diffusionAccum = 0;
    this.spawnInitialPopulation();
  }
}
