// src/sim/sim-worker.ts
// Web Worker that runs the Simulation and posts state snapshots

import { Simulation } from './simulation';
import type { MainToWorkerMessage, RenderSnapshot, CreatureSnapshot } from './worker-protocol';
import type { Herbivore, Predator, Scavenger } from './types';

let sim: Simulation | null = null;

function creatureToSnapshot(c: Herbivore | Predator | Scavenger): CreatureSnapshot {
  const snap: CreatureSnapshot = {
    id: c.id,
    type: c.type,
    x: c.pos.x,
    y: c.pos.y,
    vx: c.vel.x,
    vy: c.vel.y,
    energy: c.energy,
    age: c.age,
    maxAge: c.maxAge,
    generation: c.generation,
    lineageId: c.lineageId,
    subspecies: c.subspecies,
    behavior: c.behavior,
    size: c.traits.size,
    speed: c.traits.speed,
    visionRange: c.traits.visionRange,
    alive: c.alive,
    infected: c.infected,
    birthPosX: c.birthPos.x,
    birthPosY: c.birthPos.y,
    offspringCount: c.offspringCount,
    deathCause: c.deathCause,
  };
  if (c.type === 'predator') {
    snap.attackTimer = (c as Predator).attackTimer;
    snap.attackCooldown = (c as Predator).traits.attackCooldown;
  }
  return snap;
}

function buildSnapshot(): RenderSnapshot {
  const state = sim!.state;
  const creatures: CreatureSnapshot[] = [];

  for (let i = 0; i < state.herbivores.length; i++) {
    creatures.push(creatureToSnapshot(state.herbivores[i]));
  }
  for (let i = 0; i < state.predators.length; i++) {
    creatures.push(creatureToSnapshot(state.predators[i]));
  }
  for (let i = 0; i < state.scavengers.length; i++) {
    creatures.push(creatureToSnapshot(state.scavengers[i]));
  }

  return {
    creatures,
    corpses: state.corpses,
    stats: state.stats,
    time: state.time,
    season: state.season,
    seasonalMultiplier: state.seasonalMultiplier,
    dayPhase: state.dayPhase,
    timeOfDay: state.timeOfDay,
    weather: { ...state.weather },
    activeEvent: state.activeEvent ? { ...state.activeEvent } : null,
    feedEvents: state.feedEvents,
    plantGrid: Array.from(state.plantGrid),
    terrain: Array.from(state.terrain),
    plantGridCols: state.config.plantGridCols,
    plantGridRows: state.config.plantGridRows,
    lineageCounts: Array.from(state.lineageCounts.entries()),
    recentDeaths: Array.from(state.recentDeaths.entries()),
    config: { ...state.config },
  };
}

self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      sim = new Simulation(msg.config);
      (self as unknown as Worker).postMessage({ type: 'ready' });
      break;
    }
    case 'step': {
      if (!sim) return;
      sim.step(msg.dt);
      const snapshot = buildSnapshot();
      (self as unknown as Worker).postMessage({ type: 'snapshot', data: snapshot });
      break;
    }
    case 'reset': {
      if (!sim) return;
      sim.reset(msg.seed);
      break;
    }
    case 'setConfig': {
      if (!sim) return;
      const config = sim.state.config;
      if (msg.key in config) {
        (config as unknown as Record<string, number | boolean>)[msg.key] = msg.value;
      }
      if (msg.key === 'wrapWorld') {
        const wrap = msg.value as boolean;
        sim.herbHash.wrap = wrap;
        sim.predHash.wrap = wrap;
        sim.scavHash.wrap = wrap;
      }
      break;
    }
    case 'setWorldSize': {
      if (!sim) return;
      sim.state.config.worldWidth = msg.width;
      sim.state.config.worldHeight = msg.height;
      break;
    }
    case 'setPopCaps': {
      if (!sim) return;
      sim.state.config.maxHerbivores = msg.maxHerbivores;
      sim.state.config.maxPredators = msg.maxPredators;
      sim.state.config.maxScavengers = msg.maxScavengers;
      break;
    }
  }
};
