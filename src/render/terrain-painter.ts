import type { SimState } from '../sim/types';
import { TerrainType } from '../sim/types';

// Biome color palettes as RGB arrays
const BIOME_COLORS: Record<number, { base: [number, number, number]; alt: [number, number, number] }> = {
  [TerrainType.Land]:     { base: [196, 168, 130], alt: [139, 125, 94] },   // sandy tan to olive-brown
  [TerrainType.Fertile]:  { base: [92, 122, 61],   alt: [61, 92, 42] },     // rich earth to mossy green
  [TerrainType.Water]:    { base: [42, 107, 107],   alt: [26, 69, 69] },     // deep teal to dark blue-green
  [TerrainType.Mountain]: { base: [140, 140, 140],  alt: [90, 90, 90] },     // cool grey to slate
};

// Seasonal tint multipliers [r, g, b]
const SEASON_TINTS: [number, number, number][] = [
  [0.95, 1.08, 0.95],  // Spring: slight green boost
  [1.06, 1.02, 0.90],  // Summer: warm yellow
  [1.08, 0.95, 0.85],  // Autumn: amber/orange
  [0.90, 0.92, 1.05],  // Winter: desaturated blue-grey
];

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

function lerpRGB(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Paint terrain onto a canvas ImageData buffer.
 */
export function paintTerrain(
  imageData: ImageData,
  width: number,
  height: number,
  state: SimState,
  season: number,
): void {
  const { terrain, config } = state;
  const cols = config.plantGridCols;
  const rows = config.plantGridRows;
  const cellW = width / cols;
  const cellH = height / rows;
  const data = imageData.data;
  const seed = config.seed;

  // Seasonal tint
  const seasonIdx = season * 4;
  const si0 = Math.floor(seasonIdx) % 4;
  const si1 = (si0 + 1) % 4;
  const sf = seasonIdx - Math.floor(seasonIdx);
  const ss = sf * sf * (3 - 2 * sf);
  const tint: [number, number, number] = [
    SEASON_TINTS[si0][0] + (SEASON_TINTS[si1][0] - SEASON_TINTS[si0][0]) * ss,
    SEASON_TINTS[si0][1] + (SEASON_TINTS[si1][1] - SEASON_TINTS[si0][1]) * ss,
    SEASON_TINTS[si0][2] + (SEASON_TINTS[si1][2] - SEASON_TINTS[si0][2]) * ss,
  ];

  for (let py = 0; py < height; py++) {
    const gridY = py / cellH;
    const gy = Math.floor(gridY);
    const fy = gridY - gy;

    for (let px = 0; px < width; px++) {
      const gridX = px / cellW;
      const gx = Math.floor(gridX);
      const fx = gridX - gx;

      const clampedGx = Math.min(gx, cols - 1);
      const clampedGy = Math.min(gy, rows - 1);
      const idx = clampedGy * cols + clampedGx;
      const terrainType = terrain[idx];

      const biome = BIOME_COLORS[terrainType] || BIOME_COLORS[TerrainType.Land];

      // Multi-octave noise for natural color variation
      const nx = px / width;
      const ny = py / height;
      const n1 = valueNoise(nx * 20, ny * 20, seed + 100);
      const n2 = valueNoise(nx * 40, ny * 40, seed + 200) * 0.5;
      const n3 = valueNoise(nx * 80, ny * 80, seed + 300) * 0.25;
      const noiseVal = (n1 + n2 + n3) / 1.75;

      let color = lerpRGB(biome.base, biome.alt, noiseVal);

      // Distance-field blending at biome borders
      const checkBlend = (dx: number, dy: number): number | null => {
        const nnx = clampedGx + dx;
        const nny = clampedGy + dy;
        if (nnx < 0 || nnx >= cols || nny < 0 || nny >= rows) return null;
        const neighborType = terrain[nny * cols + nnx];
        if (neighborType !== terrainType) return neighborType;
        return null;
      };

      const blendRadius = 0.35;
      let blendColor: [number, number, number] | null = null;
      let blendAmount = 0;

      if (fx < blendRadius) {
        const neighbor = checkBlend(-1, 0);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
          blendAmount = (blendRadius - fx) / blendRadius;
        }
      }
      if (fx > 1 - blendRadius) {
        const neighbor = checkBlend(1, 0);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          const amt = (fx - (1 - blendRadius)) / blendRadius;
          if (amt > blendAmount) {
            blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
            blendAmount = amt;
          }
        }
      }
      if (fy < blendRadius) {
        const neighbor = checkBlend(0, -1);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          const amt = (blendRadius - fy) / blendRadius;
          if (amt > blendAmount) {
            blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
            blendAmount = amt;
          }
        }
      }
      if (fy > 1 - blendRadius) {
        const neighbor = checkBlend(0, 1);
        if (neighbor !== null) {
          const nb = BIOME_COLORS[neighbor] || BIOME_COLORS[TerrainType.Land];
          const amt = (fy - (1 - blendRadius)) / blendRadius;
          if (amt > blendAmount) {
            blendColor = lerpRGB(nb.base, nb.alt, noiseVal);
            blendAmount = amt;
          }
        }
      }

      if (blendColor && blendAmount > 0) {
        const s = blendAmount * blendAmount * (3 - 2 * blendAmount);
        color = lerpRGB(color, blendColor, s * 0.5);
      }

      const pixIdx = (py * width + px) * 4;
      data[pixIdx]     = Math.min(255, Math.max(0, Math.round(color[0] * tint[0])));
      data[pixIdx + 1] = Math.min(255, Math.max(0, Math.round(color[1] * tint[1])));
      data[pixIdx + 2] = Math.min(255, Math.max(0, Math.round(color[2] * tint[2])));
      data[pixIdx + 3] = 255;
    }
  }
}
