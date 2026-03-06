import type { HerbivoreTraits, PredatorTraits, ScavengerTraits } from './types';

export interface SubspeciesDef {
  name: string;
  hueBase: number;
  hueRange: number;
}

export interface HerbSubspeciesDef extends SubspeciesDef {
  speedRange: [number, number];
  sizeRange: [number, number];
  visionRange: [number, number];
  turnRateRange: [number, number];
  metabolismRange: [number, number];
}

export interface PredSubspeciesDef extends SubspeciesDef {
  speedRange: [number, number];
  sizeRange: [number, number];
  visionRange: [number, number];
  turnRateRange: [number, number];
  metabolismRange: [number, number];
  attackCooldownRange: [number, number];
  killEnergyBonus: number; // multiplier on base kill energy
}

export interface ScavSubspeciesDef extends SubspeciesDef {
  speedRange: [number, number];
  sizeRange: [number, number];
  visionRange: [number, number];
  turnRateRange: [number, number];
  metabolismRange: [number, number];
  eatSpeedMultiplier: number;
  reproductionCostMultiplier: number;
}

export const HERB_SUBSPECIES: HerbSubspeciesDef[] = [
  {
    name: 'Grazer',
    hueBase: 0x55cc77,
    hueRange: 20,
    speedRange: [35, 60],
    sizeRange: [3, 5],
    visionRange: [40, 80],
    turnRateRange: [2, 4],
    metabolismRange: [1.5, 2.5],
  },
  {
    name: 'Forager',
    hueBase: 0x88cc44,
    hueRange: 20,
    speedRange: [60, 95],
    sizeRange: [1.5, 3],
    visionRange: [70, 130],
    turnRateRange: [3, 6],
    metabolismRange: [2.5, 4],
  },
];

export const PRED_SUBSPECIES: PredSubspeciesDef[] = [
  {
    name: 'Stalker',
    hueBase: 0xcc5533,
    hueRange: 20,
    speedRange: [70, 100],
    sizeRange: [2.5, 4],
    visionRange: [80, 150],
    turnRateRange: [2.5, 5],
    metabolismRange: [2, 3.5],
    attackCooldownRange: [0.8, 1.8],
    killEnergyBonus: 1.1,
  },
  {
    name: 'Pack Hunter',
    hueBase: 0xbb4488,
    hueRange: 20,
    speedRange: [50, 80],
    sizeRange: [3, 5],
    visionRange: [70, 130],
    turnRateRange: [2, 4],
    metabolismRange: [2, 3.2],
    attackCooldownRange: [0.9, 2.0],
    killEnergyBonus: 1.0,
  },
];

export const SCAV_SUBSPECIES: ScavSubspeciesDef[] = [
  {
    name: 'Vulture',
    hueBase: 0xddbb33,
    hueRange: 20,
    speedRange: [50, 80],
    sizeRange: [1.5, 3],
    visionRange: [80, 140],
    turnRateRange: [3, 6],
    metabolismRange: [2, 3.5],
    eatSpeedMultiplier: 0.6,
    reproductionCostMultiplier: 1.0,
  },
  {
    name: 'Beetle',
    hueBase: 0x997722,
    hueRange: 20,
    speedRange: [30, 55],
    sizeRange: [2, 4],
    visionRange: [40, 80],
    turnRateRange: [2, 4],
    metabolismRange: [1.5, 2.5],
    eatSpeedMultiplier: 1.5,
    reproductionCostMultiplier: 0.7,
  },
];

/** Clamp a value to a range */
export function clampRange(val: number, range: [number, number]): number {
  return Math.max(range[0], Math.min(range[1], val));
}

/** Clamp herbivore traits to subspecies ranges */
export function clampHerbTraits(traits: HerbivoreTraits, sub: number): void {
  const def = HERB_SUBSPECIES[sub];
  traits.speed = clampRange(traits.speed, def.speedRange);
  traits.size = clampRange(traits.size, def.sizeRange);
  traits.visionRange = clampRange(traits.visionRange, def.visionRange);
  traits.turnRate = clampRange(traits.turnRate, def.turnRateRange);
  traits.metabolism = clampRange(traits.metabolism, def.metabolismRange);
}

/** Clamp predator traits to subspecies ranges */
export function clampPredTraits(traits: PredatorTraits, sub: number): void {
  const def = PRED_SUBSPECIES[sub];
  traits.speed = clampRange(traits.speed, def.speedRange);
  traits.size = clampRange(traits.size, def.sizeRange);
  traits.visionRange = clampRange(traits.visionRange, def.visionRange);
  traits.turnRate = clampRange(traits.turnRate, def.turnRateRange);
  traits.metabolism = clampRange(traits.metabolism, def.metabolismRange);
  traits.attackCooldown = clampRange(traits.attackCooldown, def.attackCooldownRange);
}

/** Clamp scavenger traits to subspecies ranges */
export function clampScavTraits(traits: ScavengerTraits, sub: number): void {
  const def = SCAV_SUBSPECIES[sub];
  traits.speed = clampRange(traits.speed, def.speedRange);
  traits.size = clampRange(traits.size, def.sizeRange);
  traits.visionRange = clampRange(traits.visionRange, def.visionRange);
  traits.turnRate = clampRange(traits.turnRate, def.turnRateRange);
  traits.metabolism = clampRange(traits.metabolism, def.metabolismRange);
}

/** Get subspecies name for any creature */
export function getSubspeciesName(type: 'herbivore' | 'predator' | 'scavenger', sub: number): string {
  if (type === 'herbivore') return HERB_SUBSPECIES[sub]?.name || 'Unknown';
  if (type === 'predator') return PRED_SUBSPECIES[sub]?.name || 'Unknown';
  return SCAV_SUBSPECIES[sub]?.name || 'Unknown';
}
