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
  turnRate: number;
  attackCooldown: number;
  metabolism: number;
  size: number;
}

export interface ScavengerTraits {
  speed: number;
  visionRange: number;
  turnRate: number;
  metabolism: number;
  size: number;
}

export interface SpatialMemory {
  foodQuality: Float32Array;   // 64 cells (8x8)
  dangerLevel: Float32Array;
  lastVisited: Float32Array;
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
  lineageId: number;
  generation: number;
  behavior: string;
  stamina: number;
  exhausted: boolean;
  lastThreatPos: Vec2 | null;
  threatTimer: number;
  offspringCount: number;
  deathCause: 'starved' | 'killed' | 'old_age' | 'disease' | null;
  memory: SpatialMemory | null;
  infected: number; // 0 = healthy, >0 = infected timer
  birthPos: Vec2;
  subspecies: number;
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

export interface FeedEvent {
  time: number;
  text: string;
  color: string;
}

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
  dayNightPeriod: number; // seconds for one full day/night cycle

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

  // World wrap
  wrapWorld: boolean;

  // Population caps (adaptive)
  maxHerbivores: number;
  maxPredators: number;
  maxScavengers: number;
}

export interface SimState {
  config: SimConfig;
  time: number;
  season: number; // 0-1 representing position in seasonal cycle
  seasonalMultiplier: number;
  dayPhase: number; // 0-1: 0-0.25 dawn, 0.25-0.5 day, 0.5-0.75 dusk, 0.75-1.0 night
  timeOfDay: 'Dawn' | 'Day' | 'Dusk' | 'Night';
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
  feedEvents: FeedEvent[];
  weather: WeatherState;
  weatherCooldown: number;
  lineageCounts: Map<number, number>;
  soilHealth: Float32Array;
  // Trait memory for adaptive reintroduction
  herbTraitMemory: HerbivoreTraits[];
  predTraitMemory: PredatorTraits[];
  scavTraitMemory: ScavengerTraits[];
  reintroductionTime: number;
  recentDeaths: Map<number, string>; // id -> deathCause for inspector
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
  timeOfDay: string;
  weatherName: string;
  maxGeneration: number;
  grazerCount: number;
  foragerCount: number;
  stalkerCount: number;
  packHunterCount: number;
  vultureCount: number;
  beetleCount: number;
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

export interface WeatherState {
  type: 'clear' | 'rain' | 'wind' | 'fog';
  intensity: number; // 0-1, ramps up/down during transitions
  duration: number;
  remaining: number;
  windAngle: number; // only used for wind
}

export const DEFAULT_CONFIG: SimConfig = {
  worldWidth: 3200,
  worldHeight: 1800,
  seed: 42,

  plantGridCols: 160,
  plantGridRows: 90,
  plantGrowthRate: 0.35,
  plantCarryingCapacity: 1.0,
  seasonalStrength: 0.4,
  seasonPeriod: 180, // 3 minutes for a full season cycle
  dayNightPeriod: 90, // 90s per full day cycle (2 cycles per season)

  initialHerbivores: 30,
  herbivoreReproductionEnergy: 85,
  herbivoreReproductionCost: 55,
  herbivoreReproductionCooldownTime: 14,
  herbivoreEatRate: 0.35,
  herbivoreMaxAge: 110,

  initialPredators: 12,
  predatorReproductionEnergy: 65,
  predatorReproductionCost: 35,
  predatorReproductionCooldownTime: 8,
  predatorAttackEnergy: 60,
  predatorMaxAge: 120,

  initialScavengers: 15,
  scavengerReproductionEnergy: 55,
  scavengerReproductionCost: 35,
  scavengerReproductionCooldownTime: 10,
  scavengerMaxAge: 95,

  mutationRate: 0.1,
  bigMutationEnabled: false,
  bigMutationChance: 0.02,

  spatialCellSize: 60,

  wrapWorld: false,

  maxHerbivores: 1500,
  maxPredators: 400,
  maxScavengers: 300,
};
