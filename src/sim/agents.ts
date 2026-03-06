// Agent creation, steering, and lifecycle

import type {
  Herbivore,
  Predator,
  Scavenger,
  HerbivoreTraits,
  PredatorTraits,
  ScavengerTraits,
  Corpse,
  SimConfig,
  SimEvent,
  SimState,
  SpatialMemory,
  Vec2,
} from './types';
import { TerrainType } from './types';
import { SeededRNG } from './rng';
import { SpatialHash } from './spatial';
import { eatPlant, getPlantGradient } from './plants';
import { getTerrainAt } from './terrain';
import { clampHerbTraits, clampPredTraits, clampScavTraits } from './subspecies';

/** Density-dependent reproduction probability. Returns true if reproduction allowed. */
function densityReproChance(currentPop: number, hardCap: number, rng: SeededRNG): boolean {
  const softCap = hardCap * 0.35;
  if (currentPop >= hardCap) return false;
  const ratio = currentPop / softCap;
  const chance = Math.max(0, 1 - ratio * ratio);
  return rng.next() < chance;
}

/** Soft boundary repulsion. Returns steering force pushing away from edges. */
function boundaryRepulsion(pos: Vec2, config: SimConfig): Vec2 {
  const margin = 120;
  const strength = 200;
  let fx = 0, fy = 0;

  if (pos.x < margin) {
    const t = 1 - pos.x / margin;
    fx += strength * t * t;
  } else if (pos.x > config.worldWidth - margin) {
    const t = 1 - (config.worldWidth - pos.x) / margin;
    fx -= strength * t * t;
  }

  if (pos.y < margin) {
    const t = 1 - pos.y / margin;
    fy += strength * t * t;
  } else if (pos.y > config.worldHeight - margin) {
    const t = 1 - (config.worldHeight - pos.y) / margin;
    fy -= strength * t * t;
  }

  return { x: fx, y: fy };
}

function getLifeStage(age: number, maxAge: number): 'baby' | 'adult' | 'elder' {
  const ratio = age / maxAge;
  if (ratio < 0.15) return 'baby';
  if (ratio < 0.75) return 'adult';
  return 'elder';
}

function getSpeedMultiplier(stage: 'baby' | 'adult' | 'elder'): number {
  if (stage === 'baby') return 0.8;
  if (stage === 'elder') return 0.85;
  return 1.0;
}

function updateStamina(creature: { stamina: number; exhausted: boolean; vel: Vec2 }, maxSpeed: number, dt: number): number {
  const spd = Math.sqrt(creature.vel.x * creature.vel.x + creature.vel.y * creature.vel.y);
  const relSpeed = spd / (maxSpeed || 1);

  if (relSpeed > 0.8) {
    creature.stamina = Math.max(0, creature.stamina - 15 * dt);
  } else if (relSpeed < 0.4) {
    creature.stamina = Math.min(100, creature.stamina + 8 * dt);
  }

  if (creature.stamina <= 0) creature.exhausted = true;
  if (creature.exhausted && creature.stamina >= 30) creature.exhausted = false;

  // Return effective max speed
  return creature.exhausted ? maxSpeed * 0.6 : maxSpeed;
}

function getDayNightModifiers(dayPhase: number): { visionMul: number; herbSpeedMul: number; predSpeedMul: number } {
  let nightIntensity: number;
  if (dayPhase < 0.2) {
    nightIntensity = Math.max(0, 1 - dayPhase / 0.2);
  } else if (dayPhase < 0.55) {
    nightIntensity = 0;
  } else if (dayPhase < 0.75) {
    nightIntensity = (dayPhase - 0.55) / 0.2;
  } else {
    nightIntensity = 1;
  }

  return {
    visionMul: 1 - nightIntensity * 0.5,
    herbSpeedMul: 1 - nightIntensity * 0.15,
    predSpeedMul: 1 + nightIntensity * 0.2,
  };
}

// --- Spatial Memory ---

function createMemory(): SpatialMemory {
  return {
    foodQuality: new Float32Array(64),
    dangerLevel: new Float32Array(64),
    lastVisited: new Float32Array(64),
  };
}

function getMemoryCell(x: number, y: number, worldW: number, worldH: number): number {
  const col = Math.min(7, Math.max(0, Math.floor((x / worldW) * 8)));
  const row = Math.min(7, Math.max(0, Math.floor((y / worldH) * 8)));
  return row * 8 + col;
}

function updateMemory(
  mem: SpatialMemory,
  x: number,
  y: number,
  worldW: number,
  worldH: number,
  time: number,
  plantDensity: number,
  threatNearby: boolean,
): void {
  const cell = getMemoryCell(x, y, worldW, worldH);
  const decay = 0.97;

  for (let i = 0; i < 64; i++) {
    mem.foodQuality[i] *= decay;
    mem.dangerLevel[i] *= decay;
  }

  mem.foodQuality[cell] = mem.foodQuality[cell] * 0.8 + plantDensity * 0.2;
  if (threatNearby) mem.dangerLevel[cell] = Math.min(1, mem.dangerLevel[cell] + 0.3);
  mem.lastVisited[cell] = time;
}

function getMemorySteer(
  mem: SpatialMemory,
  x: number,
  y: number,
  worldW: number,
  worldH: number,
  time: number,
): { x: number; y: number } {
  let fx = 0, fy = 0;
  const cellW = worldW / 8;
  const cellH = worldH / 8;

  for (let i = 0; i < 64; i++) {
    const col = i % 8;
    const row = Math.floor(i / 8);
    const targetX = (col + 0.5) * cellW;
    const targetY = (row + 0.5) * cellH;
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    const staleness = Math.min(1, (time - mem.lastVisited[i]) / 30);
    const foodAttraction = mem.foodQuality[i] * (1 - staleness * 0.5);
    const dangerRepulsion = mem.dangerLevel[i];

    const strength = (foodAttraction * 15 - dangerRepulsion * 25) / (dist * 0.1 + 1);
    fx += (dx / dist) * strength;
    fy += (dy / dist) * strength;
  }

  return { x: fx, y: fy };
}

// --- Creation ---

export function createHerbivore(
  id: number,
  x: number,
  y: number,
  rng: SeededRNG,
  config: SimConfig,
  parentTraits?: HerbivoreTraits,
  subspecies?: number
): Herbivore {
  const sub = subspecies ?? (rng.next() < 0.5 ? 0 : 1);
  const traits: HerbivoreTraits = parentTraits
    ? mutateHerbivoreTraits(parentTraits, rng, config)
    : {
        speed: rng.range(40, 80),
        visionRange: rng.range(40, 100),
        turnRate: rng.range(2, 5),
        metabolism: rng.range(1.5, 3.5),
        size: rng.range(2, 4),
      };

  clampHerbTraits(traits, sub);

  const angle = rng.range(0, Math.PI * 2);
  const spd = traits.speed * 0.3;

  return {
    type: 'herbivore',
    id,
    pos: { x, y },
    vel: { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd },
    energy: 60,
    age: 0,
    maxAge: config.herbivoreMaxAge + rng.range(-5, 5),
    reproductionCooldown: config.herbivoreReproductionCooldownTime,
    alive: true,
    lineageId: id,
    generation: 0,
    behavior: 'wandering',
    stamina: 100,
    exhausted: false,
    lastThreatPos: null,
    threatTimer: 0,
    offspringCount: 0,
    deathCause: null,
    memory: createMemory(),
    infected: 0,
    subspecies: sub,
    birthPos: { x, y },
    traits,
  };
}

export function createPredator(
  id: number,
  x: number,
  y: number,
  rng: SeededRNG,
  config: SimConfig,
  parentTraits?: PredatorTraits,
  subspecies?: number
): Predator {
  const sub = subspecies ?? (rng.next() < 0.5 ? 0 : 1);
  const traits: PredatorTraits = parentTraits
    ? mutatePredatorTraits(parentTraits, rng, config)
    : {
        speed: rng.range(55, 95),
        visionRange: rng.range(60, 130),
        turnRate: rng.range(2, 5),
        attackCooldown: rng.range(1.0, 2.5),
        metabolism: rng.range(2, 4),
        size: rng.range(2.5, 5),
      };

  clampPredTraits(traits, sub);

  const angle = rng.range(0, Math.PI * 2);
  const spd = traits.speed * 0.3;

  return {
    type: 'predator',
    id,
    pos: { x, y },
    vel: { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd },
    energy: 80,
    age: 0,
    maxAge: config.predatorMaxAge + rng.range(-5, 5),
    reproductionCooldown: config.predatorReproductionCooldownTime,
    alive: true,
    lineageId: id,
    generation: 0,
    behavior: 'wandering',
    stamina: 100,
    exhausted: false,
    lastThreatPos: null,
    threatTimer: 0,
    offspringCount: 0,
    deathCause: null,
    memory: null,
    infected: 0,
    subspecies: sub,
    birthPos: { x, y },
    attackTimer: 0,
    traits,
  };
}

export function createScavenger(
  id: number,
  x: number,
  y: number,
  rng: SeededRNG,
  config: SimConfig,
  parentTraits?: ScavengerTraits,
  subspecies?: number
): Scavenger {
  const sub = subspecies ?? (rng.next() < 0.5 ? 0 : 1);
  const traits: ScavengerTraits = parentTraits
    ? mutateScavengerTraits(parentTraits, rng, config)
    : {
        speed: rng.range(35, 70),
        visionRange: rng.range(50, 120),
        turnRate: rng.range(2, 5),
        metabolism: rng.range(1, 3),
        size: rng.range(1.5, 3.5),
      };

  clampScavTraits(traits, sub);

  const angle = rng.range(0, Math.PI * 2);
  const spd = traits.speed * 0.3;

  return {
    type: 'scavenger',
    id,
    pos: { x, y },
    vel: { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd },
    energy: 50,
    age: 0,
    maxAge: config.scavengerMaxAge + rng.range(-5, 5),
    reproductionCooldown: config.scavengerReproductionCooldownTime,
    alive: true,
    lineageId: id,
    generation: 0,
    behavior: 'wandering',
    stamina: 100,
    exhausted: false,
    lastThreatPos: null,
    threatTimer: 0,
    offspringCount: 0,
    deathCause: null,
    memory: null,
    infected: 0,
    subspecies: sub,
    birthPos: { x, y },
    traits,
  };
}

// --- Mutation ---

function mutateVal(val: number, rng: SeededRNG, config: SimConfig, min: number, max: number): number {
  const isBig = config.bigMutationEnabled && rng.next() < config.bigMutationChance;
  const sigma = isBig ? config.mutationRate * 4 : config.mutationRate;
  const mutated = val + rng.gaussian(0, sigma * val);
  return Math.max(min, Math.min(max, mutated));
}

function mutateHerbivoreTraits(parent: HerbivoreTraits, rng: SeededRNG, config: SimConfig): HerbivoreTraits {
  return {
    speed: mutateVal(parent.speed, rng, config, 15, 150),
    visionRange: mutateVal(parent.visionRange, rng, config, 15, 200),
    turnRate: mutateVal(parent.turnRate, rng, config, 0.5, 10),
    metabolism: mutateVal(parent.metabolism, rng, config, 0.5, 8),
    size: mutateVal(parent.size, rng, config, 1, 8),
  };
}

function mutatePredatorTraits(parent: PredatorTraits, rng: SeededRNG, config: SimConfig): PredatorTraits {
  return {
    speed: mutateVal(parent.speed, rng, config, 20, 170),
    visionRange: mutateVal(parent.visionRange, rng, config, 20, 250),
    turnRate: mutateVal(parent.turnRate, rng, config, 1, 8),
    attackCooldown: mutateVal(parent.attackCooldown, rng, config, 0.3, 5),
    metabolism: mutateVal(parent.metabolism, rng, config, 0.5, 8),
    size: mutateVal(parent.size, rng, config, 1.5, 10),
  };
}

function mutateScavengerTraits(parent: ScavengerTraits, rng: SeededRNG, config: SimConfig): ScavengerTraits {
  return {
    speed: mutateVal(parent.speed, rng, config, 15, 120),
    visionRange: mutateVal(parent.visionRange, rng, config, 20, 200),
    turnRate: mutateVal(parent.turnRate, rng, config, 1, 8),
    metabolism: mutateVal(parent.metabolism, rng, config, 0.5, 6),
    size: mutateVal(parent.size, rng, config, 1, 7),
  };
}

// --- Steering ---

const _steerResult: Vec2 = { x: 0, y: 0 };

export function steerHerbivore(
  h: Herbivore,
  state: SimState,
  herbHash: SpatialHash<Herbivore>,
  predHash: SpatialHash<Predator>,
  rng: SeededRNG
): Vec2 {
  let fx = 0, fy = 0;
  const config = state.config;
  const dayMods = getDayNightModifiers(state.dayPhase);
  const fogMul = state.weather.type === 'fog' ? 1 - state.weather.intensity * 0.6 : 1;
  const vision = h.traits.visionRange * dayMods.visionMul * fogMul;
  const hunger = 1 - Math.min(h.energy / 100, 1); // 0=full, 1=starving

  // 1) Attraction to plant gradient (scaled by hunger)
  const grad = getPlantGradient(state.plantGrid, h.pos.x, h.pos.y, config);
  const plantStr = 60 * (0.3 + hunger * 0.7);
  fx += grad.x * plantStr;
  fy += grad.y * plantStr;

  // 2) Repulsion from predators
  const predBuf: Predator[] = [];
  predHash.query(h.pos, vision, predBuf);
  let fleeing = false;
  for (let i = 0; i < predBuf.length; i++) {
    const p = predBuf[i];
    const delta = predHash.wrappedDelta(h.pos, p.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    if (d2 < 1) continue;
    const d = Math.sqrt(d2);
    const strength = 120 * (1 - d / vision);
    fx -= (delta.x / d) * strength;
    fy -= (delta.y / d) * strength;
    if (d < vision * 0.7) fleeing = true;
  }

  // Update threat memory
  if (fleeing && predBuf.length > 0) {
    h.lastThreatPos = { x: predBuf[0].pos.x, y: predBuf[0].pos.y };
    h.threatTimer = 5;
  }

  // Continue fleeing from remembered threat
  if (!fleeing && h.threatTimer > 0 && h.lastThreatPos) {
    const dx = h.pos.x - h.lastThreatPos.x;
    const dy = h.pos.y - h.lastThreatPos.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    fx += (dx / d) * 60;
    fy += (dy / d) * 60;
    fleeing = true;
  }

  // 3) Separation from other herbivores
  const herbBuf: Herbivore[] = [];
  herbHash.query(h.pos, 40, herbBuf);
  for (let i = 0; i < herbBuf.length; i++) {
    const other = herbBuf[i];
    if (other.id === h.id) continue;
    const delta = herbHash.wrappedDelta(h.pos, other.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    if (d2 < 1) continue;
    const d = Math.sqrt(d2);
    const strength = 15 / d;
    fx -= (delta.x / d) * strength;
    fy -= (delta.y / d) * strength;
  }

  // 3b) Alignment: match velocity of nearby herbivores
  if (herbBuf.length > 1) { // herbBuf already populated from separation query
    let avgVx = 0, avgVy = 0;
    let count = 0;
    for (let i = 0; i < herbBuf.length; i++) {
      if (herbBuf[i].id === h.id) continue;
      avgVx += herbBuf[i].vel.x;
      avgVy += herbBuf[i].vel.y;
      count++;
    }
    if (count > 0) {
      avgVx /= count;
      avgVy /= count;
      fx += (avgVx - h.vel.x) * 0.15;
      fy += (avgVy - h.vel.y) * 0.15;
    }
  }

  // 3c) Cohesion: lineage-aware — same-lineage pull stronger, forming distinct herds
  if (herbBuf.length > 1) {
    let sameX = 0, sameY = 0, sameCount = 0;
    let otherX = 0, otherY = 0, otherCount = 0;
    for (let i = 0; i < herbBuf.length; i++) {
      if (herbBuf[i].id === h.id) continue;
      const delta = herbHash.wrappedDelta(h.pos, herbBuf[i].pos);
      if (herbBuf[i].lineageId === h.lineageId) {
        sameX += delta.x;
        sameY += delta.y;
        sameCount++;
      } else {
        otherX += delta.x;
        otherY += delta.y;
        otherCount++;
      }
    }
    if (sameCount > 0) {
      sameX /= sameCount;
      sameY /= sameCount;
      fx += sameX * 0.25;
      fy += sameY * 0.25;
    }
    if (otherCount > 0) {
      otherX /= otherCount;
      otherY /= otherCount;
      fx += otherX * 0.04;
      fy += otherY * 0.04;
    }
  }

  // Home drift: gentle pull toward birthplace when far away
  const homeDx = h.birthPos.x - h.pos.x;
  const homeDy = h.birthPos.y - h.pos.y;
  const homeDist = Math.sqrt(homeDx * homeDx + homeDy * homeDy);
  if (homeDist > 400) {
    const homeStr = 5 * Math.min((homeDist - 400) / 400, 1);
    fx += (homeDx / homeDist) * homeStr;
    fy += (homeDy / homeDist) * homeStr;
  }

  // 4) Water avoidance: check terrain ahead and to sides
  const spd = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
  const ahead = 20;
  const checkPoints = [
    { x: h.pos.x + (h.vel.x / (spd || 1)) * ahead, y: h.pos.y + (h.vel.y / (spd || 1)) * ahead },
    { x: h.pos.x + ahead, y: h.pos.y },
    { x: h.pos.x - ahead, y: h.pos.y },
    { x: h.pos.x, y: h.pos.y + ahead },
    { x: h.pos.x, y: h.pos.y - ahead },
  ];
  for (const cp of checkPoints) {
    const t = getTerrainAt(state.terrain, cp.x, cp.y, config);
    if (t === TerrainType.Water || t === TerrainType.Mountain) {
      const dx = cp.x - h.pos.x;
      const dy = cp.y - h.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      fx -= (dx / d) * 150;
      fy -= (dy / d) * 150;
    }
  }

  // Mate seeking: steer toward nearest eligible mate when ready to reproduce
  const herbStage = h.age / h.maxAge;
  if (
    h.energy > state.config.herbivoreReproductionEnergy &&
    h.reproductionCooldown <= 0 &&
    herbStage >= 0.15
  ) {
    const mateScan: Herbivore[] = [];
    herbHash.query(h.pos, 120, mateScan);
    let closestMate: Herbivore | null = null;
    let closestDist = Infinity;
    for (let mi = 0; mi < mateScan.length; mi++) {
      const m = mateScan[mi];
      if (m.id === h.id || m.subspecies !== h.subspecies) continue;
      if (m.energy < state.config.herbivoreReproductionEnergy * 0.5) continue;
      if (m.reproductionCooldown > 0) continue;
      const md = herbHash.wrappedDelta(h.pos, m.pos);
      const d2 = md.x * md.x + md.y * md.y;
      if (d2 < closestDist) {
        closestDist = d2;
        closestMate = m;
      }
    }
    if (closestMate) {
      const md = herbHash.wrappedDelta(h.pos, closestMate.pos);
      const d = Math.sqrt(md.x * md.x + md.y * md.y);
      if (d > 1) {
        fx += (md.x / d) * 25;
        fy += (md.y / d) * 25;
      }
      h.behavior = 'seeking mate';
    }
  }

  // 5) Wander noise
  fx += rng.gaussian(0, 12);
  fy += rng.gaussian(0, 12);

  // 6) Memory-based navigation
  if (h.memory) {
    const memSteer = getMemorySteer(h.memory, h.pos.x, h.pos.y, config.worldWidth, config.worldHeight, state.time);
    fx += memSteer.x;
    fy += memSteer.y;
  }

  // Soft boundary repulsion
  const bnd = boundaryRepulsion(h.pos, state.config);
  fx += bnd.x;
  fy += bnd.y;

  // Set behavior state
  if (fleeing) h.behavior = 'fleeing';
  else if (hunger > 0.7) h.behavior = 'starving';
  else if (hunger > 0.4 && (grad.x * grad.x + grad.y * grad.y) > 0.01) h.behavior = 'grazing';
  else if (herbBuf.length > 2) h.behavior = 'flocking';
  else h.behavior = 'exploring';

  _steerResult.x = fx;
  _steerResult.y = fy;
  return _steerResult;
}

export function steerPredator(
  p: Predator,
  state: SimState,
  herbHash: SpatialHash<Herbivore>,
  predHash: SpatialHash<Predator>,
  rng: SeededRNG
): Vec2 {
  let fx = 0, fy = 0;
  const dayMods = getDayNightModifiers(state.dayPhase);
  const fogMul = state.weather.type === 'fog' ? 1 - state.weather.intensity * 0.6 : 1;
  const vision = p.traits.visionRange * dayMods.visionMul * fogMul;
  const hunger = 1 - Math.min(p.energy / 120, 1);

  // Satiation: well-fed predators stop hunting
  const satiationThreshold = state.config.predatorReproductionEnergy * 1.2;
  const isSatiated = p.energy > satiationThreshold;

  // 1) Attraction to herbivores (scored targeting, scaled by hunger)
  let bestDelta: Vec2 | null = null;
  let bestDist = 0;
  if (!isSatiated) {
    const herbBuf: Herbivore[] = [];
    herbHash.query(p.pos, vision, herbBuf);
    let bestScore = -Infinity;
    for (let i = 0; i < herbBuf.length; i++) {
      const h = herbBuf[i];
      const delta = herbHash.wrappedDelta(p.pos, h.pos);
      const d2 = delta.x * delta.x + delta.y * delta.y;
      const d = Math.sqrt(d2);
      if (d < 1) continue;
      // Score: prefer slow, small prey that's close
      const speedAdvantage = (p.traits.speed - h.traits.speed * 0.8);
      const sizeAdvantage = p.traits.size - h.traits.size;
      const catchScore = (speedAdvantage + sizeAdvantage * 0.5) / (d + 10);
      if (catchScore > bestScore) {
        bestScore = catchScore;
        bestDelta = { x: delta.x, y: delta.y };
        bestDist = d;
      }
    }
    if (bestDelta) {
      if (bestDist > 1) {
        // Pack coordination: more predators = stronger attraction
        const nearbyPreds: Predator[] = [];
        predHash.query(p.pos, 60, nearbyPreds);
        const packSize = nearbyPreds.length; // includes self
        const packBonus = 1 + 0.25 * Math.min(packSize - 1, 3); // 1x solo, up to 1.75x in pack of 4+

        const strength = 80 * (0.3 + hunger * 0.7) * packBonus;
        fx += (bestDelta.x / bestDist) * strength;
        fy += (bestDelta.y / bestDist) * strength;
      }
    }
  } else {
    // Satiated: patrol near nearest herbivore cluster at safe distance
    const patrolBuf: Herbivore[] = [];
    herbHash.query(p.pos, vision * 1.5, patrolBuf);
    if (patrolBuf.length > 0) {
      // Find center of nearest herbivore group
      let cx = 0, cy = 0;
      for (let i = 0; i < patrolBuf.length; i++) {
        const delta = herbHash.wrappedDelta(p.pos, patrolBuf[i].pos);
        cx += delta.x;
        cy += delta.y;
      }
      cx /= patrolBuf.length;
      cy /= patrolBuf.length;
      const d = Math.sqrt(cx * cx + cy * cy);
      if (d > 1) {
        // Orbit at ~80% of vision range
        const idealDist = vision * 0.8;
        const orbitStr = d < idealDist ? -8 : 12;
        fx += (cx / d) * orbitStr;
        fy += (cy / d) * orbitStr;
        // Add perpendicular drift for orbiting motion
        fx += (-cy / d) * 6;
        fy += (cx / d) * 6;
      }
    }
  }

  // 2) Predator spacing: stalkers separate, pack hunters cluster
  const predBuf: Predator[] = [];
  predHash.query(p.pos, p.subspecies === 1 ? 120 : 35, predBuf);
  for (let i = 0; i < predBuf.length; i++) {
    const other = predBuf[i];
    if (other.id === p.id) continue;
    const delta = predHash.wrappedDelta(p.pos, other.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    if (d2 < 1) continue;
    const d = Math.sqrt(d2);
    if (p.subspecies === 1 && other.subspecies === 1) {
      // Pack hunters: attract toward each other (maintain ~30px spacing)
      if (d > 30) {
        const strength = 15;
        fx += (delta.x / d) * strength;
        fy += (delta.y / d) * strength;
      } else {
        const strength = 10 / d;
        fx -= (delta.x / d) * strength;
        fy -= (delta.y / d) * strength;
      }
    } else {
      // Stalkers and cross-subspecies: separate
      const strength = 20 / d;
      fx -= (delta.x / d) * strength;
      fy -= (delta.y / d) * strength;
    }
  }

  // 3) Water avoidance: check terrain ahead and to sides
  const spd = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
  const ahead = 20;
  const checkPoints = [
    { x: p.pos.x + (p.vel.x / (spd || 1)) * ahead, y: p.pos.y + (p.vel.y / (spd || 1)) * ahead },
    { x: p.pos.x + ahead, y: p.pos.y },
    { x: p.pos.x - ahead, y: p.pos.y },
    { x: p.pos.x, y: p.pos.y + ahead },
    { x: p.pos.x, y: p.pos.y - ahead },
  ];
  for (const cp of checkPoints) {
    const t = getTerrainAt(state.terrain, cp.x, cp.y, state.config);
    if (t === TerrainType.Water || t === TerrainType.Mountain) {
      const dx = cp.x - p.pos.x;
      const dy = cp.y - p.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      fx -= (dx / d) * 150;
      fy -= (dy / d) * 150;
    }
  }

  // Mate seeking
  const predStage = p.age / p.maxAge;
  if (
    p.energy > state.config.predatorReproductionEnergy &&
    p.reproductionCooldown <= 0 &&
    predStage >= 0.15
  ) {
    const mateScan: Predator[] = [];
    predHash.query(p.pos, 120, mateScan);
    let closestMate: Predator | null = null;
    let closestDist = Infinity;
    for (let mi = 0; mi < mateScan.length; mi++) {
      const m = mateScan[mi];
      if (m.id === p.id || m.subspecies !== p.subspecies) continue;
      if (m.energy < state.config.predatorReproductionEnergy * 0.5) continue;
      if (m.reproductionCooldown > 0) continue;
      const md = predHash.wrappedDelta(p.pos, m.pos);
      const d2 = md.x * md.x + md.y * md.y;
      if (d2 < closestDist) {
        closestDist = d2;
        closestMate = m;
      }
    }
    if (closestMate) {
      const md = predHash.wrappedDelta(p.pos, closestMate.pos);
      const d = Math.sqrt(md.x * md.x + md.y * md.y);
      if (d > 1) {
        fx += (md.x / d) * 20;
        fy += (md.y / d) * 20;
      }
      p.behavior = 'seeking mate';
    }
  }

  // 4) Wander noise
  fx += rng.gaussian(0, 10);
  fy += rng.gaussian(0, 10);

  const bnd = boundaryRepulsion(p.pos, state.config);
  fx += bnd.x;
  fy += bnd.y;

  // Set behavior state
  const hasTarget = bestDelta !== null;
  if (hasTarget && bestDist < 30) p.behavior = 'attacking';
  else if (hasTarget) p.behavior = 'hunting';
  else if (hunger > 0.6) p.behavior = 'searching';
  else if (predBuf.length > 1) p.behavior = 'pack roaming';
  else p.behavior = 'prowling';

  _steerResult.x = fx;
  _steerResult.y = fy;
  return _steerResult;
}

export function steerScavenger(
  s: Scavenger,
  state: SimState,
  scavHash: SpatialHash<Scavenger>,
  rng: SeededRNG
): Vec2 {
  let fx = 0, fy = 0;
  const config = state.config;
  const dayMods = getDayNightModifiers(state.dayPhase);
  const fogMul = state.weather.type === 'fog' ? 1 - state.weather.intensity * 0.6 : 1;
  const vision = s.traits.visionRange * dayMods.visionMul * fogMul;
  const hunger = 1 - Math.min(s.energy / 80, 1);

  // 1) Attraction to nearest corpse
  let closestCorpseDist = Infinity;
  let closestCorpseDelta: Vec2 | null = null;
  for (let i = 0; i < state.corpses.length; i++) {
    const c = state.corpses[i];
    let dx = c.x - s.pos.x;
    let dy = c.y - s.pos.y;
    if (config.wrapWorld) {
      const hw = config.worldWidth * 0.5;
      const hh = config.worldHeight * 0.5;
      if (dx > hw) dx -= config.worldWidth;
      else if (dx < -hw) dx += config.worldWidth;
      if (dy > hh) dy -= config.worldHeight;
      else if (dy < -hh) dy += config.worldHeight;
    }
    const d2 = dx * dx + dy * dy;
    if (d2 < vision * vision && d2 < closestCorpseDist) {
      closestCorpseDist = d2;
      closestCorpseDelta = { x: dx, y: dy };
    }
  }
  if (closestCorpseDelta) {
    const d = Math.sqrt(closestCorpseDist);
    if (d > 1) {
      const strength = 70 * (0.3 + hunger * 0.7);
      fx += (closestCorpseDelta.x / d) * strength;
      fy += (closestCorpseDelta.y / d) * strength;
    }
  }

  // 2) Separation from other scavengers
  const scavBuf: Scavenger[] = [];
  scavHash.query(s.pos, 30, scavBuf);
  for (let i = 0; i < scavBuf.length; i++) {
    const other = scavBuf[i];
    if (other.id === s.id) continue;
    const delta = scavHash.wrappedDelta(s.pos, other.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    if (d2 < 1) continue;
    const d = Math.sqrt(d2);
    fx -= (delta.x / d) * (15 / d);
    fy -= (delta.y / d) * (15 / d);
  }

  // 3) Water avoidance (same as other creatures)
  const spd = Math.sqrt(s.vel.x * s.vel.x + s.vel.y * s.vel.y);
  const ahead = 20;
  const checkPoints = [
    { x: s.pos.x + (s.vel.x / (spd || 1)) * ahead, y: s.pos.y + (s.vel.y / (spd || 1)) * ahead },
    { x: s.pos.x + ahead, y: s.pos.y },
    { x: s.pos.x - ahead, y: s.pos.y },
    { x: s.pos.x, y: s.pos.y + ahead },
    { x: s.pos.x, y: s.pos.y - ahead },
  ];
  for (const cp of checkPoints) {
    const t = getTerrainAt(state.terrain, cp.x, cp.y, config);
    if (t === TerrainType.Water || t === TerrainType.Mountain) {
      const dx = cp.x - s.pos.x;
      const dy = cp.y - s.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      fx -= (dx / d) * 150;
      fy -= (dy / d) * 150;
    }
  }

  // Mate seeking
  const scavStage = s.age / s.maxAge;
  if (
    s.energy > state.config.scavengerReproductionEnergy &&
    s.reproductionCooldown <= 0 &&
    scavStage >= 0.15
  ) {
    const mateScan: Scavenger[] = [];
    scavHash.query(s.pos, 120, mateScan);
    let closestMate: Scavenger | null = null;
    let closestDist = Infinity;
    for (let mi = 0; mi < mateScan.length; mi++) {
      const m = mateScan[mi];
      if (m.id === s.id || m.subspecies !== s.subspecies) continue;
      if (m.energy < state.config.scavengerReproductionEnergy * 0.5) continue;
      if (m.reproductionCooldown > 0) continue;
      const md = scavHash.wrappedDelta(s.pos, m.pos);
      const d2 = md.x * md.x + md.y * md.y;
      if (d2 < closestDist) {
        closestDist = d2;
        closestMate = m;
      }
    }
    if (closestMate) {
      const md = scavHash.wrappedDelta(s.pos, closestMate.pos);
      const d = Math.sqrt(md.x * md.x + md.y * md.y);
      if (d > 1) {
        fx += (md.x / d) * 20;
        fy += (md.y / d) * 20;
      }
      s.behavior = 'seeking mate';
    }
  }

  // 4) Wander noise
  fx += rng.gaussian(0, 10);
  fy += rng.gaussian(0, 10);

  const bnd = boundaryRepulsion(s.pos, state.config);
  fx += bnd.x;
  fy += bnd.y;

  // Set behavior state
  const hasCorpse = closestCorpseDelta !== null;
  if (hasCorpse && closestCorpseDist < 400) s.behavior = 'feeding';
  else if (hasCorpse) s.behavior = 'scavenging';
  else if (hunger > 0.6) s.behavior = 'searching';
  else s.behavior = 'roaming';

  _steerResult.x = fx;
  _steerResult.y = fy;
  return _steerResult;
}

// --- Update ---

export function updateHerbivores(
  state: SimState,
  dt: number,
  herbHash: SpatialHash<Herbivore>,
  predHash: SpatialHash<Predator>,
  rng: SeededRNG,
  events: SimEvent[]
): Herbivore[] {
  const config = state.config;
  const newborns: Herbivore[] = [];

  for (let i = 0; i < state.herbivores.length; i++) {
    const h = state.herbivores[i];
    if (!h.alive) continue;

    // Age
    h.age += dt;
    const stage = getLifeStage(h.age, h.maxAge);
    h.reproductionCooldown = Math.max(0, h.reproductionCooldown - dt);
    h.threatTimer = Math.max(0, h.threatTimer - dt);

    // Quadratic speed cost — fast creatures pay super-linearly
    const spdH = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
    const relSpeedH = spdH / (h.traits.speed || 1);
    const speedCost = h.traits.speed * relSpeedH * relSpeedH * 0.008;
    const sizeCost = h.traits.size * 0.25;
    const baseMeta = h.traits.metabolism + h.traits.speed * Math.sqrt(h.traits.speed) * 0.001;
    h.energy -= (baseMeta + speedCost + sizeCost) * dt;

    // Eat plants
    const eaten = eatPlant(
      state.plantGrid,
      h.pos.x,
      h.pos.y,
      config.herbivoreEatRate * dt,
      config
    );
    h.energy += eaten * 25; // energy per plant unit

    // Update spatial memory
    if (h.memory) {
      const col = Math.floor(h.pos.x / (config.worldWidth / config.plantGridCols));
      const row = Math.floor(h.pos.y / (config.worldHeight / config.plantGridRows));
      const pidx = Math.max(0, Math.min(config.plantGridCols * config.plantGridRows - 1, row * config.plantGridCols + col));
      const plantDensity = state.plantGrid[pidx] || 0;
      updateMemory(h.memory, h.pos.x, h.pos.y, config.worldWidth, config.worldHeight, state.time, plantDensity, h.behavior === 'fleeing');
    }

    // Steering
    const steer = steerHerbivore(h, state, herbHash, predHash, rng);

    // Alarm propagation: fleeing herbivores alert nearby herd members
    if (h.behavior === 'fleeing' && h.lastThreatPos) {
      const nearbyHerbs: Herbivore[] = [];
      herbHash.query(h.pos, 50, nearbyHerbs);
      for (const other of nearbyHerbs) {
        if (other.id === h.id) continue;
        if (other.threatTimer <= 0) {
          other.lastThreatPos = { x: h.lastThreatPos.x, y: h.lastThreatPos.y };
          other.threatTimer = 3; // Shorter timer for chain alarms
        }
      }
    }

    // Apply force (limited by turnRate)
    const turnRate = h.traits.turnRate;
    h.vel.x += steer.x * turnRate * dt;
    h.vel.y += steer.y * turnRate * dt;

    // Clamp speed
    const spd = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
    const maxSpd = updateStamina(h, h.traits.speed, dt);
    if (spd > maxSpd) {
      h.vel.x = (h.vel.x / spd) * maxSpd;
      h.vel.y = (h.vel.y / spd) * maxSpd;
    }
    // Min speed to avoid getting stuck
    if (spd < 5) {
      const angle = rng.range(0, Math.PI * 2);
      h.vel.x = Math.cos(angle) * 10;
      h.vel.y = Math.sin(angle) * 10;
    }

    // Move
    const dayModsH = getDayNightModifiers(state.dayPhase);
    const spdMul = getSpeedMultiplier(stage) * dayModsH.herbSpeedMul;
    h.pos.x += h.vel.x * dt * spdMul;
    h.pos.y += h.vel.y * dt * spdMul;
    // Wind drift
    if (state.weather.type === 'wind') {
      const windForce = 15 * state.weather.intensity;
      h.pos.x += Math.cos(state.weather.windAngle) * windForce * dt;
      h.pos.y += Math.sin(state.weather.windAngle) * windForce * dt;
    }
    if (config.wrapWorld) {
      h.pos.x = ((h.pos.x % config.worldWidth) + config.worldWidth) % config.worldWidth;
      h.pos.y = ((h.pos.y % config.worldHeight) + config.worldHeight) % config.worldHeight;
    } else {
      if (h.pos.x < 0) h.pos.x = 0;
      else if (h.pos.x >= config.worldWidth) h.pos.x = config.worldWidth - 0.1;
      if (h.pos.y < 0) h.pos.y = 0;
      else if (h.pos.y >= config.worldHeight) h.pos.y = config.worldHeight - 0.1;
    }

    // Disease spread and damage
    if (h.infected > 0) {
      h.infected -= dt;
      h.energy -= 2 * dt; // Damage over time
      // Spread to nearby same-species
      const diseaseNearby: typeof state.herbivores[0][] = [];
      herbHash.query(h.pos, 30, diseaseNearby);
      for (const other of diseaseNearby) {
        if (other.id === h.id || other.infected > 0) continue;
        const ddx = h.pos.x - other.pos.x;
        const ddy = h.pos.y - other.pos.y;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        if (rng.next() < 0.05 / dd) {
          other.infected = 8;
        }
      }
      if (h.infected <= 0) h.infected = 0;
    }

    // Death
    if (h.energy <= 0 || h.age > h.maxAge) {
      h.deathCause = h.infected > 0 ? 'disease' : (h.energy <= 0 ? 'starved' : 'old_age');
      h.alive = false;
      events.push({ type: 'death', creatureType: 'herbivore', x: h.pos.x, y: h.pos.y });
      continue;
    }

    // Reproduction: two-parent mating system
    if (
      h.energy > config.herbivoreReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      h.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.herbivores.length + newborns.length < config.maxHerbivores &&
      densityReproChance(state.herbivores.length, config.maxHerbivores, rng)
    ) {
      // Find nearby mate: same subspecies, energy > 50% threshold, cooldown ready, not baby
      const mateBuf: Herbivore[] = [];
      herbHash.query(h.pos, 60, mateBuf);
      let mate: Herbivore | null = null;
      for (let mi = 0; mi < mateBuf.length; mi++) {
        const m = mateBuf[mi];
        if (m.id === h.id) continue;
        if (m.subspecies !== h.subspecies) continue;
        if (m.energy < config.herbivoreReproductionEnergy * 0.5) continue;
        if (m.reproductionCooldown > 0) continue;
        const mStage = m.age / m.maxAge;
        if (mStage < 0.15) continue; // not baby
        mate = m;
        break;
      }

      if (mate) {
        // Both parents pay half cost
        const halfCost = config.herbivoreReproductionCost / 2;
        h.energy -= halfCost;
        mate.energy -= halfCost;
        h.reproductionCooldown = config.herbivoreReproductionCooldownTime;
        mate.reproductionCooldown = config.herbivoreReproductionCooldownTime;
        h.offspringCount++;
        mate.offspringCount++;

        // Spawn at midpoint
        const midX = (h.pos.x + mate.pos.x) / 2;
        const midY = (h.pos.y + mate.pos.y) / 2;
        const childX = Math.max(0, Math.min(config.worldWidth - 0.1, midX + rng.range(-10, 10)));
        const childY = Math.max(0, Math.min(config.worldHeight - 0.1, midY + rng.range(-10, 10)));

        // Blend traits from both parents
        const blendedTraits = {} as HerbivoreTraits;
        const keys = Object.keys(h.traits) as (keyof HerbivoreTraits)[];
        for (const key of keys) {
          const t = 0.3 + rng.next() * 0.4; // lerp 0.3-0.7
          blendedTraits[key] = h.traits[key] * t + mate.traits[key] * (1 - t);
        }

        const child = createHerbivore(
          state.nextId++,
          childX,
          childY,
          rng,
          config,
          blendedTraits,
          h.subspecies
        );
        child.energy = config.herbivoreReproductionCost * 0.6;
        child.lineageId = h.lineageId;
        child.generation = Math.max(h.generation, mate.generation) + 1;
        events.push({ type: 'birth', creatureType: 'herbivore', x: child.pos.x, y: child.pos.y });
        newborns.push(child);
        state.herbTraitMemory.push({ ...blendedTraits });
        if (state.herbTraitMemory.length > 50) state.herbTraitMemory.shift();
      }
    }
  }

  return newborns;
}

export function updatePredators(
  state: SimState,
  dt: number,
  herbHash: SpatialHash<Herbivore>,
  predHash: SpatialHash<Predator>,
  rng: SeededRNG,
  events: SimEvent[]
): Predator[] {
  const config = state.config;
  const newborns: Predator[] = [];

  for (let i = 0; i < state.predators.length; i++) {
    const p = state.predators[i];
    if (!p.alive) continue;

    // Age
    p.age += dt;
    const stage = getLifeStage(p.age, p.maxAge);
    p.reproductionCooldown = Math.max(0, p.reproductionCooldown - dt);
    p.attackTimer = Math.max(0, p.attackTimer - dt);

    // Quadratic speed cost — fast creatures pay super-linearly
    const spdP = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
    const relSpeedP = spdP / (p.traits.speed || 1);
    const speedCostP = p.traits.speed * relSpeedP * relSpeedP * 0.008;
    const sizeCostP = p.traits.size * 0.12;
    const baseMetaP = p.traits.metabolism + p.traits.speed * Math.sqrt(p.traits.speed) * 0.001;
    // Low-population survival boost: reduced metabolism when population is struggling
    const predPopFactor = state.predators.length < 15 ? 0.7 : 1.0;
    p.energy -= (baseMetaP + speedCostP + sizeCostP) * dt * predPopFactor;

    // Hunt: try to eat nearest herbivore (satiated predators skip attacking)
    if (p.attackTimer <= 0 && p.energy <= config.predatorReproductionEnergy * 1.8) {
      const herbBuf: Herbivore[] = [];
      const attackRange = p.traits.size * 3 + 8;
      herbHash.query(p.pos, attackRange, herbBuf);
      for (let j = 0; j < herbBuf.length; j++) {
        const h = herbBuf[j];
        if (!h.alive) continue;
        const delta = herbHash.wrappedDelta(p.pos, h.pos);
        const d2 = delta.x * delta.x + delta.y * delta.y;
        if (d2 < attackRange * attackRange) {
          // Attack probability based on size/speed mismatch
          const speedAdv = (p.traits.speed - h.traits.speed) / (p.traits.speed || 1);
          const sizeAdv = (p.traits.size - h.traits.size) / (p.traits.size || 1);
          const killChance = Math.max(0.15, Math.min(0.95, 0.55 + speedAdv * 0.3 + sizeAdv * 0.2));

          if (rng.next() < killChance) {
            h.alive = false;
            h.deathCause = 'killed';
            events.push({ type: 'death', creatureType: 'herbivore', x: h.pos.x, y: h.pos.y });
            // Kill energy bonus by subspecies
            let killEnergy = config.predatorAttackEnergy;
            if (p.subspecies === 1) {
              // Pack Hunter: scales with nearby allies
              const nearPreds: Predator[] = [];
              predHash.query(p.pos, 120, nearPreds);
              const allies = nearPreds.filter(o => o.id !== p.id).length;
              // 1.1x solo, 1.4x with 1 ally, 1.7x with 2+
              killEnergy *= 1.1 + Math.min(allies, 3) * 0.3;
            } else {
              // Stalker: flat 15% solo bonus
              killEnergy *= 1.15;
            }
            p.energy += killEnergy;
          } else {
            // Failed attack — still costs energy
            p.energy -= config.predatorAttackEnergy * 0.15;
          }
          p.attackTimer = p.traits.attackCooldown;
          break;
        }
      }
    }

    // Steering
    const steer = steerPredator(p, state, herbHash, predHash, rng);
    const turnRate = p.traits.turnRate;
    p.vel.x += steer.x * turnRate * dt;
    p.vel.y += steer.y * turnRate * dt;

    // Clamp speed
    const spd = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
    const maxSpd = updateStamina(p, p.traits.speed, dt);
    if (spd > maxSpd) {
      p.vel.x = (p.vel.x / spd) * maxSpd;
      p.vel.y = (p.vel.y / spd) * maxSpd;
    }
    if (spd < 5) {
      const angle = rng.range(0, Math.PI * 2);
      p.vel.x = Math.cos(angle) * 12;
      p.vel.y = Math.sin(angle) * 12;
    }

    // Move
    const dayModsP = getDayNightModifiers(state.dayPhase);
    const spdMulP = getSpeedMultiplier(stage) * dayModsP.predSpeedMul;
    p.pos.x += p.vel.x * dt * spdMulP;
    p.pos.y += p.vel.y * dt * spdMulP;
    // Wind drift
    if (state.weather.type === 'wind') {
      const windForce = 15 * state.weather.intensity;
      p.pos.x += Math.cos(state.weather.windAngle) * windForce * dt;
      p.pos.y += Math.sin(state.weather.windAngle) * windForce * dt;
    }
    if (config.wrapWorld) {
      p.pos.x = ((p.pos.x % config.worldWidth) + config.worldWidth) % config.worldWidth;
      p.pos.y = ((p.pos.y % config.worldHeight) + config.worldHeight) % config.worldHeight;
    } else {
      if (p.pos.x < 0) p.pos.x = 0;
      else if (p.pos.x >= config.worldWidth) p.pos.x = config.worldWidth - 0.1;
      if (p.pos.y < 0) p.pos.y = 0;
      else if (p.pos.y >= config.worldHeight) p.pos.y = config.worldHeight - 0.1;
    }

    // Disease spread and damage
    if (p.infected > 0) {
      p.infected -= dt;
      p.energy -= 2 * dt; // Damage over time
      // Spread to nearby same-species
      const diseaseNearbyP: typeof state.predators[0][] = [];
      predHash.query(p.pos, 30, diseaseNearbyP);
      for (const other of diseaseNearbyP) {
        if (other.id === p.id || other.infected > 0) continue;
        const ddx = p.pos.x - other.pos.x;
        const ddy = p.pos.y - other.pos.y;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        if (rng.next() < 0.05 / dd) {
          other.infected = 8;
        }
      }
      if (p.infected <= 0) p.infected = 0;
    }

    // Death
    if (p.energy <= 0 || p.age > p.maxAge) {
      p.deathCause = p.infected > 0 ? 'disease' : (p.energy <= 0 ? 'starved' : 'old_age');
      p.alive = false;
      events.push({ type: 'death', creatureType: 'predator', x: p.pos.x, y: p.pos.y });
      continue;
    }

    // Reproduction: two-parent mating system
    if (
      p.energy > config.predatorReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      p.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.predators.length + newborns.length < config.maxPredators &&
      densityReproChance(state.predators.length, config.maxPredators, rng)
    ) {
      const mateBuf: Predator[] = [];
      predHash.query(p.pos, 200, mateBuf);
      let mate: Predator | null = null;
      for (let mi = 0; mi < mateBuf.length; mi++) {
        const m = mateBuf[mi];
        if (m.id === p.id) continue;
        if (m.energy < config.predatorReproductionEnergy * 0.4) continue;
        if (m.reproductionCooldown > 0) continue;
        const mStage = m.age / m.maxAge;
        if (mStage < 0.15) continue;
        mate = m;
        break;
      }

      if (mate) {
        const halfCost = config.predatorReproductionCost / 2;
        p.energy -= halfCost;
        mate.energy -= halfCost;
        p.reproductionCooldown = config.predatorReproductionCooldownTime;
        mate.reproductionCooldown = config.predatorReproductionCooldownTime;
        p.offspringCount++;
        mate.offspringCount++;

        const midX = (p.pos.x + mate.pos.x) / 2;
        const midY = (p.pos.y + mate.pos.y) / 2;
        const childX = Math.max(0, Math.min(config.worldWidth - 0.1, midX + rng.range(-10, 10)));
        const childY = Math.max(0, Math.min(config.worldHeight - 0.1, midY + rng.range(-10, 10)));

        const blendedTraits = {} as PredatorTraits;
        const keys = Object.keys(p.traits) as (keyof PredatorTraits)[];
        for (const key of keys) {
          const t = 0.3 + rng.next() * 0.4;
          blendedTraits[key] = p.traits[key] * t + mate.traits[key] * (1 - t);
        }

        const child = createPredator(
          state.nextId++,
          childX,
          childY,
          rng,
          config,
          blendedTraits,
          p.subspecies
        );
        child.energy = config.predatorReproductionCost * 0.6;
        child.lineageId = p.lineageId;
        child.generation = Math.max(p.generation, mate.generation) + 1;
        events.push({ type: 'birth', creatureType: 'predator', x: child.pos.x, y: child.pos.y });
        newborns.push(child);
        state.predTraitMemory.push({ ...blendedTraits });
        if (state.predTraitMemory.length > 50) state.predTraitMemory.shift();
      } else if (state.predators.length < 10 && p.energy > config.predatorReproductionEnergy * 1.5) {
        // Solo reproduction when population is critically low (higher cost)
        p.energy -= config.predatorReproductionCost;
        p.reproductionCooldown = config.predatorReproductionCooldownTime * 1.5;
        p.offspringCount++;

        const child = createPredator(
          state.nextId++,
          p.pos.x + rng.range(-15, 15),
          p.pos.y + rng.range(-15, 15),
          rng,
          config,
          { ...p.traits },
          p.subspecies
        );
        child.energy = config.predatorReproductionCost * 0.5;
        child.lineageId = p.lineageId;
        child.generation = p.generation + 1;
        events.push({ type: 'birth', creatureType: 'predator', x: child.pos.x, y: child.pos.y });
        newborns.push(child);
      }
    }
  }

  return newborns;
}

export function updateScavengers(
  state: SimState,
  dt: number,
  scavHash: SpatialHash<Scavenger>,
  rng: SeededRNG,
  events: SimEvent[]
): Scavenger[] {
  const config = state.config;
  const newborns: Scavenger[] = [];

  for (let i = 0; i < state.scavengers.length; i++) {
    const s = state.scavengers[i];
    if (!s.alive) continue;

    s.age += dt;
    const stage = getLifeStage(s.age, s.maxAge);
    s.reproductionCooldown = Math.max(0, s.reproductionCooldown - dt);

    // Quadratic speed cost — fast creatures pay super-linearly
    const spdS = Math.sqrt(s.vel.x * s.vel.x + s.vel.y * s.vel.y);
    const relSpeedS = spdS / (s.traits.speed || 1);
    const speedCostS = s.traits.speed * relSpeedS * relSpeedS * 0.008;
    const sizeCostS = s.traits.size * 0.12;
    const baseMetaS = s.traits.metabolism + s.traits.speed * Math.sqrt(s.traits.speed) * 0.001;
    s.energy -= (baseMetaS + speedCostS + sizeCostS) * dt;

    // Eat corpses: check nearby corpses
    const eatRange = s.traits.size * 3 + 10;
    for (let j = 0; j < state.corpses.length; j++) {
      const c = state.corpses[j];
      let dx = c.x - s.pos.x;
      let dy = c.y - s.pos.y;
      if (config.wrapWorld) {
        const hw = config.worldWidth * 0.5;
        const hh = config.worldHeight * 0.5;
        if (dx > hw) dx -= config.worldWidth;
        else if (dx < -hw) dx += config.worldWidth;
        if (dy > hh) dy -= config.worldHeight;
        else if (dy < -hh) dy += config.worldHeight;
      }
      const d2 = dx * dx + dy * dy;
      if (d2 < eatRange * eatRange && c.energy > 0) {
        const eaten = Math.min(c.energy, 12 * dt);
        c.energy -= eaten;
        s.energy += eaten * 2.5;
        break; // eat one corpse at a time
      }
    }

    // Fallback: nibble plants when starving (low efficiency)
    if (s.energy < 25) {
      const nibbled = eatPlant(
        state.plantGrid,
        s.pos.x,
        s.pos.y,
        config.herbivoreEatRate * 0.2 * dt,
        config
      );
      s.energy += nibbled * 15;
    }

    // Steering
    const steer = steerScavenger(s, state, scavHash, rng);
    const turnRate = 3;
    s.vel.x += steer.x * turnRate * dt;
    s.vel.y += steer.y * turnRate * dt;

    const spd = Math.sqrt(s.vel.x * s.vel.x + s.vel.y * s.vel.y);
    const maxSpd = updateStamina(s, s.traits.speed, dt);
    if (spd > maxSpd) {
      s.vel.x = (s.vel.x / spd) * maxSpd;
      s.vel.y = (s.vel.y / spd) * maxSpd;
    }
    if (spd < 5) {
      const angle = rng.range(0, Math.PI * 2);
      s.vel.x = Math.cos(angle) * 10;
      s.vel.y = Math.sin(angle) * 10;
    }

    const spdMulS = getSpeedMultiplier(stage);
    s.pos.x += s.vel.x * dt * spdMulS;
    s.pos.y += s.vel.y * dt * spdMulS;
    // Wind drift
    if (state.weather.type === 'wind') {
      const windForce = 15 * state.weather.intensity;
      s.pos.x += Math.cos(state.weather.windAngle) * windForce * dt;
      s.pos.y += Math.sin(state.weather.windAngle) * windForce * dt;
    }
    if (config.wrapWorld) {
      s.pos.x = ((s.pos.x % config.worldWidth) + config.worldWidth) % config.worldWidth;
      s.pos.y = ((s.pos.y % config.worldHeight) + config.worldHeight) % config.worldHeight;
    } else {
      if (s.pos.x < 0) s.pos.x = 0;
      else if (s.pos.x >= config.worldWidth) s.pos.x = config.worldWidth - 0.1;
      if (s.pos.y < 0) s.pos.y = 0;
      else if (s.pos.y >= config.worldHeight) s.pos.y = config.worldHeight - 0.1;
    }

    // Disease spread and damage
    if (s.infected > 0) {
      s.infected -= dt;
      s.energy -= 2 * dt; // Damage over time
      // Spread to nearby same-species
      const diseaseNearbyS: typeof state.scavengers[0][] = [];
      scavHash.query(s.pos, 30, diseaseNearbyS);
      for (const other of diseaseNearbyS) {
        if (other.id === s.id || other.infected > 0) continue;
        const ddx = s.pos.x - other.pos.x;
        const ddy = s.pos.y - other.pos.y;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        if (rng.next() < 0.05 / dd) {
          other.infected = 8;
        }
      }
      if (s.infected <= 0) s.infected = 0;
    }

    if (s.energy <= 0 || s.age > s.maxAge) {
      s.deathCause = s.infected > 0 ? 'disease' : (s.energy <= 0 ? 'starved' : 'old_age');
      s.alive = false;
      events.push({ type: 'death', creatureType: 'scavenger', x: s.pos.x, y: s.pos.y });
      continue;
    }

    // Reproduction: two-parent mating system
    if (
      s.energy > config.scavengerReproductionEnergy * (stage === 'elder' ? 2 : 1) &&
      s.reproductionCooldown <= 0 &&
      stage !== 'baby' &&
      state.scavengers.length + newborns.length < config.maxScavengers &&
      densityReproChance(state.scavengers.length, config.maxScavengers, rng)
    ) {
      // Find nearby mate: same subspecies, energy > 50% threshold, cooldown ready, not baby
      const mateBuf: Scavenger[] = [];
      scavHash.query(s.pos, 60, mateBuf);
      let mate: Scavenger | null = null;
      for (let mi = 0; mi < mateBuf.length; mi++) {
        const m = mateBuf[mi];
        if (m.id === s.id) continue;
        if (m.subspecies !== s.subspecies) continue;
        if (m.energy < config.scavengerReproductionEnergy * 0.5) continue;
        if (m.reproductionCooldown > 0) continue;
        const mStage = m.age / m.maxAge;
        if (mStage < 0.15) continue; // not baby
        mate = m;
        break;
      }

      if (mate) {
        // Both parents pay half cost
        const halfCost = config.scavengerReproductionCost / 2;
        s.energy -= halfCost;
        mate.energy -= halfCost;
        s.reproductionCooldown = config.scavengerReproductionCooldownTime;
        mate.reproductionCooldown = config.scavengerReproductionCooldownTime;
        s.offspringCount++;
        mate.offspringCount++;

        // Spawn at midpoint
        const midX = (s.pos.x + mate.pos.x) / 2;
        const midY = (s.pos.y + mate.pos.y) / 2;
        const childX = Math.max(0, Math.min(config.worldWidth - 0.1, midX + rng.range(-10, 10)));
        const childY = Math.max(0, Math.min(config.worldHeight - 0.1, midY + rng.range(-10, 10)));

        // Blend traits from both parents
        const blendedTraits = {} as ScavengerTraits;
        const keys = Object.keys(s.traits) as (keyof ScavengerTraits)[];
        for (const key of keys) {
          const t = 0.3 + rng.next() * 0.4; // lerp 0.3-0.7
          blendedTraits[key] = s.traits[key] * t + mate.traits[key] * (1 - t);
        }

        const child = createScavenger(
          state.nextId++,
          childX,
          childY,
          rng,
          config,
          blendedTraits,
          s.subspecies
        );
        child.energy = config.scavengerReproductionCost * 0.6;
        child.lineageId = s.lineageId;
        child.generation = Math.max(s.generation, mate.generation) + 1;
        events.push({ type: 'birth', creatureType: 'scavenger', x: child.pos.x, y: child.pos.y });
        newborns.push(child);
        state.scavTraitMemory.push({ ...blendedTraits });
        if (state.scavTraitMemory.length > 50) state.scavTraitMemory.shift();
      }
    }
  }

  return newborns;
}
