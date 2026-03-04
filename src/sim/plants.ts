// Plant density grid with logistic growth and seasonal modulation

import type { SimConfig } from './types';

export function createPlantGrid(config: SimConfig): Float32Array {
  const size = config.plantGridCols * config.plantGridRows;
  const grid = new Float32Array(size);
  // Start at ~10% capacity for a sparse beginning
  for (let i = 0; i < size; i++) {
    grid[i] = config.plantCarryingCapacity * 0.1;
  }
  return grid;
}

export function getSeasonalMultiplier(time: number, config: SimConfig): number {
  // Sine wave: peaks in "summer", troughs in "winter"
  const phase = (time / config.seasonPeriod) * Math.PI * 2;
  return 1 + config.seasonalStrength * Math.sin(phase);
}

export function getSeasonName(time: number, config: SimConfig): string {
  const phase = ((time / config.seasonPeriod) % 1 + 1) % 1;
  if (phase < 0.25) return 'Spring';
  if (phase < 0.5) return 'Summer';
  if (phase < 0.75) return 'Autumn';
  return 'Winter';
}

export function updatePlants(
  grid: Float32Array,
  dt: number,
  seasonalMult: number,
  config: SimConfig
): void {
  const K = config.plantCarryingCapacity;
  const r = config.plantGrowthRate * seasonalMult;
  const cols = config.plantGridCols;
  const rows = config.plantGridRows;

  for (let i = 0; i < cols * rows; i++) {
    const p = grid[i];
    // Logistic growth: dp/dt = r * p * (1 - p/K)
    const growth = r * p * (1 - p / K) * dt;
    grid[i] = Math.max(0, Math.min(K, p + growth));
  }

  // Diffusion: spread nutrients to neighbors (simple averaging)
  // Only every few frames to save perf - caller handles this
}

export function diffusePlants(
  grid: Float32Array,
  config: SimConfig,
  diffusionRate: number = 0.02
): void {
  const cols = config.plantGridCols;
  const rows = config.plantGridRows;
  const temp = new Float32Array(grid.length);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const val = grid[idx];

      // Get wrapped neighbors
      const left = grid[y * cols + ((x - 1 + cols) % cols)];
      const right = grid[y * cols + ((x + 1) % cols)];
      const up = grid[((y - 1 + rows) % rows) * cols + x];
      const down = grid[((y + 1) % rows) * cols + x];

      const avg = (left + right + up + down) * 0.25;
      temp[idx] = val + (avg - val) * diffusionRate;
    }
  }

  grid.set(temp);
}

export function eatPlant(
  grid: Float32Array,
  worldX: number,
  worldY: number,
  amount: number,
  config: SimConfig
): number {
  const cellW = config.worldWidth / config.plantGridCols;
  const cellH = config.worldHeight / config.plantGridRows;
  const cx = Math.floor(worldX / cellW) % config.plantGridCols;
  const cy = Math.floor(worldY / cellH) % config.plantGridRows;
  const idx = (cy < 0 ? cy + config.plantGridRows : cy) * config.plantGridCols +
              (cx < 0 ? cx + config.plantGridCols : cx);

  const available = grid[idx];
  const eaten = Math.min(available, amount);
  grid[idx] -= eaten;
  return eaten;
}

export function getPlantDensityAt(
  grid: Float32Array,
  worldX: number,
  worldY: number,
  config: SimConfig
): number {
  const cellW = config.worldWidth / config.plantGridCols;
  const cellH = config.worldHeight / config.plantGridRows;
  let cx = Math.floor(worldX / cellW) % config.plantGridCols;
  let cy = Math.floor(worldY / cellH) % config.plantGridRows;
  if (cx < 0) cx += config.plantGridCols;
  if (cy < 0) cy += config.plantGridRows;
  return grid[cy * config.plantGridCols + cx];
}

export function getPlantGradient(
  grid: Float32Array,
  worldX: number,
  worldY: number,
  config: SimConfig
): { x: number; y: number } {
  const cellW = config.worldWidth / config.plantGridCols;
  const cellH = config.worldHeight / config.plantGridRows;
  let cx = Math.floor(worldX / cellW) % config.plantGridCols;
  let cy = Math.floor(worldY / cellH) % config.plantGridRows;
  if (cx < 0) cx += config.plantGridCols;
  if (cy < 0) cy += config.plantGridRows;

  const cols = config.plantGridCols;
  const rows = config.plantGridRows;

  const left = grid[cy * cols + ((cx - 1 + cols) % cols)];
  const right = grid[cy * cols + ((cx + 1) % cols)];
  const up = grid[((cy - 1 + rows) % rows) * cols + cx];
  const down = grid[((cy + 1) % rows) * cols + cx];

  return {
    x: (right - left) * 0.5,
    y: (down - up) * 0.5,
  };
}
