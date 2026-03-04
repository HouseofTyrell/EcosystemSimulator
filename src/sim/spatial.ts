// Spatial hash grid for efficient neighbor queries
// O(1) insert, O(k) query where k = entities in nearby cells

import type { Vec2 } from './types';

export class SpatialHash<T extends { pos: Vec2 }> {
  private cellSize: number;
  private invCellSize: number;
  private cols: number;
  private rows: number;
  private cells: T[][];
  private worldW: number;
  private worldH: number;

  constructor(worldW: number, worldH: number, cellSize: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cols = Math.ceil(worldW / cellSize);
    this.rows = Math.ceil(worldH / cellSize);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = [];
    }
  }

  clear(): void {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i].length = 0;
    }
  }

  private cellIndex(x: number, y: number): number {
    // Wrap coordinates
    let cx = Math.floor(x * this.invCellSize) % this.cols;
    let cy = Math.floor(y * this.invCellSize) % this.rows;
    if (cx < 0) cx += this.cols;
    if (cy < 0) cy += this.rows;
    return cy * this.cols + cx;
  }

  insert(entity: T): void {
    const idx = this.cellIndex(entity.pos.x, entity.pos.y);
    this.cells[idx].push(entity);
  }

  // Query all entities within radius of pos (toroidal distance)
  query(pos: Vec2, radius: number, result: T[]): void {
    result.length = 0;
    const r2 = radius * radius;
    const minCX = Math.floor((pos.x - radius) * this.invCellSize);
    const maxCX = Math.floor((pos.x + radius) * this.invCellSize);
    const minCY = Math.floor((pos.y - radius) * this.invCellSize);
    const maxCY = Math.floor((pos.y + radius) * this.invCellSize);

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        let wcx = cx % this.cols;
        let wcy = cy % this.rows;
        if (wcx < 0) wcx += this.cols;
        if (wcy < 0) wcy += this.rows;

        const cell = this.cells[wcy * this.cols + wcx];
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          const d2 = this.wrappedDist2(pos, e.pos);
          if (d2 <= r2) {
            result.push(e);
          }
        }
      }
    }
  }

  wrappedDist2(a: Vec2, b: Vec2): number {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const hw = this.worldW * 0.5;
    const hh = this.worldH * 0.5;
    if (dx > hw) dx -= this.worldW;
    else if (dx < -hw) dx += this.worldW;
    if (dy > hh) dy -= this.worldH;
    else if (dy < -hh) dy += this.worldH;
    return dx * dx + dy * dy;
  }

  wrappedDelta(from: Vec2, to: Vec2): Vec2 {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    const hw = this.worldW * 0.5;
    const hh = this.worldH * 0.5;
    if (dx > hw) dx -= this.worldW;
    else if (dx < -hw) dx += this.worldW;
    if (dy > hh) dy -= this.worldH;
    else if (dy < -hh) dy += this.worldH;
    return { x: dx, y: dy };
  }
}
