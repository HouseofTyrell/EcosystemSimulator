// Agent creation, steering, and lifecycle

import type {
  Herbivore,
  Predator,
  HerbivoreTraits,
  PredatorTraits,
  SimConfig,
  SimEvent,
  SimState,
  Vec2,
} from './types';
import { TerrainType } from './types';
import { SeededRNG } from './rng';
import { SpatialHash } from './spatial';
import { eatPlant, getPlantGradient } from './plants';
import { getTerrainAt } from './terrain';

// --- Creation ---

export function createHerbivore(
  id: number,
  x: number,
  y: number,
  rng: SeededRNG,
  config: SimConfig,
  parentTraits?: HerbivoreTraits
): Herbivore {
  const traits: HerbivoreTraits = parentTraits
    ? mutateHerbivoreTraits(parentTraits, rng, config)
    : {
        speed: rng.range(40, 80),
        visionRange: rng.range(40, 100),
        turnRate: rng.range(2, 5),
        metabolism: rng.range(1.5, 3.5),
        size: rng.range(2, 4),
      };

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
    traits,
  };
}

export function createPredator(
  id: number,
  x: number,
  y: number,
  rng: SeededRNG,
  config: SimConfig,
  parentTraits?: PredatorTraits
): Predator {
  const traits: PredatorTraits = parentTraits
    ? mutatePredatorTraits(parentTraits, rng, config)
    : {
        speed: rng.range(55, 95),
        visionRange: rng.range(60, 130),
        attackCooldown: rng.range(1.0, 2.5),
        metabolism: rng.range(2, 4),
        size: rng.range(2.5, 5),
      };

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
    attackTimer: 0,
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
    attackCooldown: mutateVal(parent.attackCooldown, rng, config, 0.3, 5),
    metabolism: mutateVal(parent.metabolism, rng, config, 0.5, 8),
    size: mutateVal(parent.size, rng, config, 1.5, 10),
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
  const vision = h.traits.visionRange;
  const hunger = 1 - Math.min(h.energy / 100, 1); // 0=full, 1=starving

  // 1) Attraction to plant gradient (scaled by hunger)
  const grad = getPlantGradient(state.plantGrid, h.pos.x, h.pos.y, config);
  const plantStr = 60 * (0.3 + hunger * 0.7);
  fx += grad.x * plantStr;
  fy += grad.y * plantStr;

  // 2) Repulsion from predators
  const predBuf: Predator[] = [];
  predHash.query(h.pos, vision, predBuf);
  for (let i = 0; i < predBuf.length; i++) {
    const p = predBuf[i];
    const delta = predHash.wrappedDelta(h.pos, p.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    if (d2 < 1) continue;
    const d = Math.sqrt(d2);
    const strength = 120 * (1 - d / vision);
    fx -= (delta.x / d) * strength;
    fy -= (delta.y / d) * strength;
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

  // 3c) Cohesion: steer toward center of nearby herbivores
  if (herbBuf.length > 1) {
    let cx = 0, cy = 0;
    let count = 0;
    for (let i = 0; i < herbBuf.length; i++) {
      if (herbBuf[i].id === h.id) continue;
      const delta = herbHash.wrappedDelta(h.pos, herbBuf[i].pos);
      cx += delta.x;
      cy += delta.y;
      count++;
    }
    if (count > 0) {
      cx /= count;
      cy /= count;
      fx += cx * 0.12;
      fy += cy * 0.12;
    }
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
    if (getTerrainAt(state.terrain, cp.x, cp.y, config) === TerrainType.Water) {
      const dx = cp.x - h.pos.x;
      const dy = cp.y - h.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      fx -= (dx / d) * 150;
      fy -= (dy / d) * 150;
    }
  }

  // 5) Wander noise
  fx += rng.gaussian(0, 12);
  fy += rng.gaussian(0, 12);

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
  const vision = p.traits.visionRange;
  const hunger = 1 - Math.min(p.energy / 120, 1);

  // 1) Attraction to herbivores (scaled by hunger)
  const herbBuf: Herbivore[] = [];
  herbHash.query(p.pos, vision, herbBuf);
  let closestDist = Infinity;
  let closestDelta: Vec2 | null = null;
  for (let i = 0; i < herbBuf.length; i++) {
    const h = herbBuf[i];
    const delta = herbHash.wrappedDelta(p.pos, h.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    if (d2 < closestDist) {
      closestDist = d2;
      closestDelta = { x: delta.x, y: delta.y };
    }
  }
  if (closestDelta) {
    const d = Math.sqrt(closestDist);
    if (d > 1) {
      // Pack coordination: more predators = stronger attraction
      const nearbyPreds: Predator[] = [];
      predHash.query(p.pos, 60, nearbyPreds);
      const packSize = nearbyPreds.length; // includes self
      const packBonus = 1 + 0.25 * Math.min(packSize - 1, 3); // 1x solo, up to 1.75x in pack of 4+

      const strength = 80 * (0.3 + hunger * 0.7) * packBonus;
      fx += (closestDelta.x / d) * strength;
      fy += (closestDelta.y / d) * strength;
    }
  }

  // 2) Separation from other predators
  const predBuf: Predator[] = [];
  predHash.query(p.pos, 35, predBuf);
  for (let i = 0; i < predBuf.length; i++) {
    const other = predBuf[i];
    if (other.id === p.id) continue;
    const delta = predHash.wrappedDelta(p.pos, other.pos);
    const d2 = delta.x * delta.x + delta.y * delta.y;
    if (d2 < 1) continue;
    const d = Math.sqrt(d2);
    const strength = 20 / d;
    fx -= (delta.x / d) * strength;
    fy -= (delta.y / d) * strength;
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
    if (getTerrainAt(state.terrain, cp.x, cp.y, state.config) === TerrainType.Water) {
      const dx = cp.x - p.pos.x;
      const dy = cp.y - p.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      fx -= (dx / d) * 150;
      fy -= (dy / d) * 150;
    }
  }

  // 4) Wander noise
  fx += rng.gaussian(0, 10);
  fy += rng.gaussian(0, 10);

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
    h.reproductionCooldown = Math.max(0, h.reproductionCooldown - dt);

    // Energy cost: metabolism + speed-proportional cost (tradeoff: fast = expensive)
    const speedCost = (Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y) / 60) * 0.5;
    const sizeCost = h.traits.size * 0.15;
    h.energy -= (h.traits.metabolism + speedCost + sizeCost) * dt;

    // Eat plants
    const eaten = eatPlant(
      state.plantGrid,
      h.pos.x,
      h.pos.y,
      config.herbivoreEatRate * dt,
      config
    );
    h.energy += eaten * 40; // energy per plant unit

    // Steering
    const steer = steerHerbivore(h, state, herbHash, predHash, rng);

    // Apply force (limited by turnRate)
    const turnRate = h.traits.turnRate;
    h.vel.x += steer.x * turnRate * dt;
    h.vel.y += steer.y * turnRate * dt;

    // Clamp speed
    const spd = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
    const maxSpd = h.traits.speed;
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
    h.pos.x = ((h.pos.x + h.vel.x * dt) % config.worldWidth + config.worldWidth) % config.worldWidth;
    h.pos.y = ((h.pos.y + h.vel.y * dt) % config.worldHeight + config.worldHeight) % config.worldHeight;

    // Death
    if (h.energy <= 0 || h.age > h.maxAge) {
      h.alive = false;
      events.push({ type: 'death', creatureType: 'herbivore', x: h.pos.x, y: h.pos.y });
      continue;
    }

    // Reproduction
    if (
      h.energy > config.herbivoreReproductionEnergy &&
      h.reproductionCooldown <= 0
    ) {
      h.energy -= config.herbivoreReproductionCost;
      h.reproductionCooldown = config.herbivoreReproductionCooldownTime;

      const offsetX = rng.range(-15, 15);
      const offsetY = rng.range(-15, 15);
      const child = createHerbivore(
        state.nextId++,
        ((h.pos.x + offsetX) % config.worldWidth + config.worldWidth) % config.worldWidth,
        ((h.pos.y + offsetY) % config.worldHeight + config.worldHeight) % config.worldHeight,
        rng,
        config,
        h.traits
      );
      child.energy = config.herbivoreReproductionCost * 0.6;
      events.push({ type: 'birth', creatureType: 'herbivore', x: child.pos.x, y: child.pos.y });
      newborns.push(child);
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
    p.reproductionCooldown = Math.max(0, p.reproductionCooldown - dt);
    p.attackTimer = Math.max(0, p.attackTimer - dt);

    // Energy cost
    const speedCost = (Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y) / 60) * 0.6;
    const sizeCost = p.traits.size * 0.12;
    p.energy -= (p.traits.metabolism + speedCost + sizeCost) * dt;

    // Hunt: try to eat nearest herbivore
    if (p.attackTimer <= 0) {
      const herbBuf: Herbivore[] = [];
      const attackRange = p.traits.size * 3 + 8;
      herbHash.query(p.pos, attackRange, herbBuf);
      for (let j = 0; j < herbBuf.length; j++) {
        const h = herbBuf[j];
        if (!h.alive) continue;
        const delta = herbHash.wrappedDelta(p.pos, h.pos);
        const d2 = delta.x * delta.x + delta.y * delta.y;
        if (d2 < attackRange * attackRange) {
          h.alive = false;
          events.push({ type: 'death', creatureType: 'herbivore', x: h.pos.x, y: h.pos.y });
          p.energy += config.predatorAttackEnergy;
          p.attackTimer = p.traits.attackCooldown;
          break;
        }
      }
    }

    // Steering
    const steer = steerPredator(p, state, herbHash, predHash, rng);
    const turnRate = 3.5;
    p.vel.x += steer.x * turnRate * dt;
    p.vel.y += steer.y * turnRate * dt;

    // Clamp speed
    const spd = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
    const maxSpd = p.traits.speed;
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
    p.pos.x = ((p.pos.x + p.vel.x * dt) % config.worldWidth + config.worldWidth) % config.worldWidth;
    p.pos.y = ((p.pos.y + p.vel.y * dt) % config.worldHeight + config.worldHeight) % config.worldHeight;

    // Death
    if (p.energy <= 0 || p.age > p.maxAge) {
      p.alive = false;
      events.push({ type: 'death', creatureType: 'predator', x: p.pos.x, y: p.pos.y });
      continue;
    }

    // Reproduction
    if (
      p.energy > config.predatorReproductionEnergy &&
      p.reproductionCooldown <= 0
    ) {
      p.energy -= config.predatorReproductionCost;
      p.reproductionCooldown = config.predatorReproductionCooldownTime;

      const offsetX = rng.range(-15, 15);
      const offsetY = rng.range(-15, 15);
      const child = createPredator(
        state.nextId++,
        ((p.pos.x + offsetX) % config.worldWidth + config.worldWidth) % config.worldWidth,
        ((p.pos.y + offsetY) % config.worldHeight + config.worldHeight) % config.worldHeight,
        rng,
        config,
        p.traits
      );
      child.energy = config.predatorReproductionCost * 0.6;
      events.push({ type: 'birth', creatureType: 'predator', x: child.pos.x, y: child.pos.y });
      newborns.push(child);
    }
  }

  return newborns;
}
