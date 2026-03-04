import type { SimConfig } from './types';
import { TerrainType } from './types';

function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = hashNoise(ix, iy, seed);
  const n10 = hashNoise(ix + 1, iy, seed);
  const n01 = hashNoise(ix, iy + 1, seed);
  const n11 = hashNoise(ix + 1, iy + 1, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

export function generateTerrain(config: SimConfig, seed: number): Uint8Array {
  const cols = config.plantGridCols;
  const rows = config.plantGridRows;
  const terrain = new Uint8Array(cols * rows);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = x / cols;
      const ny = y / rows;
      const n1 = valueNoise(nx * 5, ny * 5, seed);
      const n2 = valueNoise(nx * 10, ny * 10, seed + 7777) * 0.5;
      const val = n1 + n2;

      const idx = y * cols + x;
      if (val < 0.35) {
        terrain[idx] = TerrainType.Water;
      } else if (val < 0.50) {
        terrain[idx] = TerrainType.Fertile;
      } else if (val > 1.15) {
        terrain[idx] = TerrainType.Mountain;
      } else {
        terrain[idx] = TerrainType.Land;
      }
    }
  }

  return terrain;
}

export function getTerrainAt(terrain: Uint8Array, worldX: number, worldY: number, config: SimConfig): TerrainType {
  const cellW = config.worldWidth / config.plantGridCols;
  const cellH = config.worldHeight / config.plantGridRows;
  let cx = Math.floor(worldX / cellW) % config.plantGridCols;
  let cy = Math.floor(worldY / cellH) % config.plantGridRows;
  if (cx < 0) cx += config.plantGridCols;
  if (cy < 0) cy += config.plantGridRows;
  return terrain[cy * config.plantGridCols + cx];
}
