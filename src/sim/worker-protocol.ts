// src/sim/worker-protocol.ts
import type { SimConfig, SimStats, FeedEvent, Corpse, WeatherState, ActiveEvent } from './types';

export interface CreatureSnapshot {
  id: number;
  type: 'herbivore' | 'predator' | 'scavenger' | 'insect';
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number;
  maxAge: number;
  generation: number;
  lineageId: number;
  subspecies: number;
  behavior: string;
  size: number;
  speed: number;
  visionRange: number;
  alive: boolean;
  infected: number;
  birthPosX: number;
  birthPosY: number;
  homeBaseX: number;
  homeBaseY: number;
  offspringCount: number;
  deathCause: 'starved' | 'killed' | 'old_age' | 'disease' | null;
  attackTimer?: number;
  attackCooldown?: number;
}

export interface RenderSnapshot {
  creatures: CreatureSnapshot[];
  corpses: Corpse[];
  stats: SimStats;
  time: number;
  season: number;
  seasonalMultiplier: number;
  dayPhase: number;
  timeOfDay: 'Dawn' | 'Day' | 'Dusk' | 'Night';
  weather: WeatherState;
  activeEvent: ActiveEvent | null;
  feedEvents: FeedEvent[];
  plantGrid: number[];
  terrain: number[];
  plantGridCols: number;
  plantGridRows: number;
  lineageCounts: [number, number][];
  recentDeaths: [number, string][];
  config: SimConfig;
}

export type MainToWorkerMessage =
  | { type: 'init'; config: Partial<SimConfig> }
  | { type: 'step'; dt: number }
  | { type: 'reset'; seed?: number }
  | { type: 'setConfig'; key: string; value: number | boolean }
  | { type: 'setWorldSize'; width: number; height: number }
  | { type: 'setPopCaps'; maxHerbivores: number; maxPredators: number; maxScavengers: number; maxInsects: number };

export type WorkerToMainMessage =
  | { type: 'snapshot'; data: RenderSnapshot }
  | { type: 'ready'; config: SimConfig };
