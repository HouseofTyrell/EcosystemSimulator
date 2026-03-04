import type { SimState } from './types';
import { SeededRNG } from './rng';

export function updateEvents(state: SimState, dt: number, rng: SeededRNG): void {
  // Tick active event
  if (state.activeEvent) {
    state.activeEvent.remaining -= dt;
    if (state.activeEvent.remaining <= 0) {
      state.activeEvent = null;
      // Set cooldown after event ends
      state.eventCooldown = 30 + rng.next() * 60;
    }
  }

  // Tick cooldown
  if (!state.activeEvent && state.eventCooldown > 0) {
    state.eventCooldown -= dt;
    return;
  }

  // Try to trigger new event
  if (!state.activeEvent && state.eventCooldown <= 0) {
    // Small chance per frame
    if (rng.next() < 0.002) {
      const roll = rng.next();
      if (roll < 0.35) {
        // Drought: plant growth drops
        state.activeEvent = { type: 'drought', remaining: 20, duration: 20 };
      } else if (roll < 0.7) {
        // Bloom: plant growth spikes
        state.activeEvent = { type: 'bloom', remaining: 15, duration: 15 };
      } else {
        // Disease: instant effect
        applyDisease(state, rng);
        state.activeEvent = { type: 'disease', remaining: 3, duration: 3 };
      }
    }
  }
}

function applyDisease(state: SimState, rng: SeededRNG): void {
  // Pick a random species and seed 2-3 creatures with infection
  const roll = rng.next();
  const targets =
    roll < 0.33 && state.herbivores.length > 0
      ? state.herbivores
      : roll < 0.66 && state.predators.length > 0
        ? state.predators
        : state.scavengers.length > 0
          ? state.scavengers
          : null;

  if (!targets || targets.length === 0) return;

  // Don't target species within 10s of reintroduction
  if (state.time - state.reintroductionTime < 10) return;

  const count = Math.min(2 + Math.floor(rng.next() * 2), targets.length); // 2-3 initial infections
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng.next() * targets.length);
    if (targets[idx].infected <= 0) {
      targets[idx].infected = 10; // 10 second infection timer
    }
  }
}

export function getEventPlantMultiplier(state: SimState): number {
  if (!state.activeEvent) return 1;
  if (state.activeEvent.type === 'drought') return 0.25;
  if (state.activeEvent.type === 'bloom') return 3;
  return 1;
}
