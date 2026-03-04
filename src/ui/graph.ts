import type { SimStats } from '../sim/types';

const MAX_POINTS = 300;
const GRAPH_HEIGHT = 60;

interface DataPoint {
  herbivores: number;
  predators: number;
  scavengers: number;
  plantDensity: number;
}

export class PopulationGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private data: DataPoint[] = [];
  private lastSampleTime: number = -1;
  private visible: boolean = true;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'population-graph';
    this.canvas.height = GRAPH_HEIGHT;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.style.width = window.innerWidth + 'px';
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  update(stats: SimStats, simTime: number): void {
    const sampleTime = Math.floor(simTime);
    if (sampleTime <= this.lastSampleTime) return;
    this.lastSampleTime = sampleTime;

    this.data.push({
      herbivores: stats.herbivoreCount,
      predators: stats.predatorCount,
      scavengers: stats.scavengerCount,
      plantDensity: stats.plantDensity * 100,
    });

    if (this.data.length > MAX_POINTS) {
      this.data.shift();
    }

    if (this.visible) this.draw();
  }

  reset(): void {
    this.data = [];
    this.lastSampleTime = -1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = GRAPH_HEIGHT;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(10, 10, 15, 0.7)';
    ctx.fillRect(0, 0, w, h);

    if (this.data.length < 2) return;

    let max = 1;
    for (const d of this.data) {
      max = Math.max(max, d.herbivores, d.predators, d.scavengers, d.plantDensity);
    }
    max *= 1.1;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    const lines: { key: keyof DataPoint; color: string }[] = [
      { key: 'plantDensity', color: '#336633' },
      { key: 'scavengers', color: '#ccaa44' },
      { key: 'predators', color: '#cc5544' },
      { key: 'herbivores', color: '#55ddaa' },
    ];

    const step = w / (MAX_POINTS - 1);
    const offsetX = (MAX_POINTS - this.data.length) * step;

    for (const line of lines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < this.data.length; i++) {
        const x = offsetX + i * step;
        const y = h - (this.data[i][line.key] / max) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
