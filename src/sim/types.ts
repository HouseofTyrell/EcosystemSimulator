// === Core simulation types ===

export interface Vec2 {
  x: number;
  y: number;
}

export interface HerbivoreTraits {
  speed: number;
  visionRange: number;
  turnRate: number;
  metabolism: number;
  size: number;
}

export interface PredatorTraits {
  speed: number;
  visionRange: number;
  attackCooldown: number;
  metabolism: number;
  size: number;
}

export interface ScavengerTraits {
  speed: number;
  visionRange: number;
  metabolism: number;
  size: number;
}

export interface Agent {
  id: number;
  pos: Vec2;
  vel: Vec2;
  energy: number;
  age: number;
  maxAge: number;
  reproductionCooldown: number;
  alive: boolean;
}

export interface Herbivore extends Agent {
  type: 'herbivore';
  traits: HerbivoreTraits;
}

export interface Predator extends Agent {
  type: 'predator';
  attackTimer: number;
  pos: Vec2;
  vel: Vec2;
  traits: PredatorTraits;
}

export interface Scavenger extends Agent {
  type: 'scavenger';
  traits: ScavengerTraits;
}

export type Creature = Herbivore | Predator | Scavenger;

export const enum TerrainType {
  Land = 0,
  Water = 1,
  Fertile = 2,
  Mountain = 3,
}

export interface SimConfig {
  worldWidth: number;
  worldHeight: number;
  seed: number;

  // Plant grid
  plantGridCols: number;
  plantGridRows: number;
  plantGrowthRate: number;
  plantCarryingCapacity: number;
  seasonalStrength: number;
  seasonPeriod: number; // seconds for full cycle

  // Herbivore defaults
  initialHerbivores: number;
  herbivoreReproductionEnergy: number;
  herbivoreReproductionCost: number;
  herbivoreReproductionCooldownTime: number;
  herbivoreEatRate: number;
  herbivoreMaxAge: number;

  // Predator defaults
  initialPredators: number;
  predatorReproductionEnergy: number;
  predatorReproductionCost: number;
  predatorReproductionCooldownTime: number;
  predatorAttackEnergy: number;
  predatorMaxAge: number;

  // Scavenger defaults
  initialScavengers: number;
  scavengerReproductionEnergy: number;
  scavengerReproductionCost: number;
  scavengerReproductionCooldownTime: number;
  scavengerMaxAge: number;

  // Evolution
  mutationRate: number;
  bigMutationEnabled: boolean;
  bigMutationChance: number;

  // Spatial hash
  spatialCellSize: number;
}

export interface SimState {
  config: SimConfig;
  time: number;
  season: number; // 0-1 representing position in seasonal cycle
  seasonalMultiplier: number;
  plantGrid: Float32Array;
  terrain: Uint8Array;
  herbivores: Herbivore[];
  predators: Predator[];
  scavengers: Scavenger[];
  corpses: Corpse[];
  nextId: number;
  stats: SimStats;
  events: SimEvent[];
  activeEvent: ActiveEvent | null;
  eventCooldown: number;
}

export interface SimStats {
  herbivoreCount: number;
  predatorCount: number;
  plantDensity: number;
  avgHerbivoreSpeed: number;
  avgHerbivoreSize: number;
  avgHerbivoreVision: number;
  avgPredatorSpeed: number;
  avgPredatorSize: number;
  avgPredatorVision: number;
  scavengerCount: number;
  avgScavengerSpeed: number;
  avgScavengerSize: number;
  seasonName: string;
  activeEventName: string;
}

export interface SimEvent {
  type: 'birth' | 'death';
  creatureType: 'herbivore' | 'predator' | 'scavenger';
  x: number;
  y: number;
}

export interface Corpse {
  x: number;
  y: number;
  energy: number;
  creatureType: 'herbivore' | 'predator' | 'scavenger';
  decayTimer: number;
  maxDecay: number;
}

export interface ActiveEvent {
  type: 'drought' | 'bloom' | 'disease';
  remaining: number;
  duration: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  worldWidth: 1600,
  worldHeight: 900,
  seed: 42,

  plantGridCols: 80,
  plantGridRows: 45,
  plantGrowthRate: 0.3,
  plantCarryingCapacity: 1.0,
  seasonalStrength: 0.4,
  seasonPeriod: 180, // 3 minutes for a full season cycle

  initialHerbivores: 12,
  herbivoreReproductionEnergy: 80,
  herbivoreReproductionCost: 50,
  herbivoreReproductionCooldownTime: 5,
  herbivoreEatRate: 0.4,
  herbivoreMaxAge: 60,

  initialPredators: 3,
  predatorReproductionEnergy: 100,
  predatorReproductionCost: 60,
  predatorReproductionCooldownTime: 8,
  predatorAttackEnergy: 40,
  predatorMaxAge: 50,

  initialScavengers: 5,
  scavengerReproductionEnergy: 60,
  scavengerReproductionCost: 35,
  scavengerReproductionCooldownTime: 6,
  scavengerMaxAge: 45,

  mutationRate: 0.1,
  bigMutationEnabled: false,
  bigMutationChance: 0.02,

  spatialCellSize: 60,
};
