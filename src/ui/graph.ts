import type { SimStats } from '../sim/types';

const MAX_POINTS = 300;
const GRAPH_HEIGHT = 100;
const SPARKLINE_HEIGHT = 32;

interface DataPoint {
  herbivores: number;
  predators: number;
  scavengers: number;
  insects: number;
  plantDensity: number;
  avgHerbSpeed: number;
  avgHerbSize: number;
  avgPredSpeed: number;
  avgPredSize: number;
}

export class PopulationGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private traitCanvas: HTMLCanvasElement;
  private traitCtx: CanvasRenderingContext2D;
  private panel: HTMLDivElement;
  private header: HTMLDivElement;
  private data: DataPoint[] = [];
  private lastSampleTime: number = -1;
  private visible: boolean = true;
  showTraits: boolean = false;

  constructor(container: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.id = 'population-graph-panel';

    this.header = document.createElement('div');
    this.header.className = 'graph-header';
    this.header.innerHTML = `<span>Population</span><span class="graph-legend"><span class="legend-dot" style="background:#55ddaa"></span>Herb <span class="legend-dot" style="background:#cc5544"></span>Pred <span class="legend-dot" style="background:#ccaa44"></span>Scav <span class="legend-dot" style="background:#bb8822"></span>Ins</span>`;
    this.panel.appendChild(this.header);

    this.traitCanvas = document.createElement('canvas');
    this.traitCanvas.id = 'trait-sparklines';
    this.traitCanvas.height = SPARKLINE_HEIGHT;
    this.traitCanvas.style.display = 'none';
    this.panel.appendChild(this.traitCanvas);
    this.traitCtx = this.traitCanvas.getContext('2d')!;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'population-graph';
    this.canvas.height = GRAPH_HEIGHT;
    this.panel.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    container.appendChild(this.panel);
    this.resize();
  }

  resize(): void {
    const w = this.panel.clientWidth - 12;
    this.canvas.width = w;
    this.canvas.style.width = w + 'px';
    this.traitCanvas.width = w;
    this.traitCanvas.style.width = w + 'px';
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.panel.style.display = v ? '' : 'none';
    this.traitCanvas.style.display = (v && this.showTraits) ? 'block' : 'none';
  }

  getPanel(): HTMLDivElement {
    return this.panel;
  }

  getHeader(): HTMLElement {
    return this.header;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  toggleTraits(): void {
    this.showTraits = !this.showTraits;
    this.traitCanvas.style.display = (this.visible && this.showTraits) ? 'block' : 'none';
    if (this.showTraits && this.visible) this.drawTraits();
  }

  update(stats: SimStats, simTime: number): void {
    const sampleTime = Math.floor(simTime);
    if (sampleTime <= this.lastSampleTime) return;
    this.lastSampleTime = sampleTime;

    this.data.push({
      herbivores: stats.herbivoreCount,
      predators: stats.predatorCount,
      scavengers: stats.scavengerCount,
      insects: stats.insectCount,
      plantDensity: stats.plantDensity * 100,
      avgHerbSpeed: stats.avgHerbivoreSpeed,
      avgHerbSize: stats.avgHerbivoreSize,
      avgPredSpeed: stats.avgPredatorSpeed,
      avgPredSize: stats.avgPredatorSize,
    });

    if (this.data.length > MAX_POINTS) {
      this.data.shift();
    }

    if (this.visible) {
      this.draw();
      if (this.showTraits) this.drawTraits();
    }
  }

  reset(): void {
    this.data = [];
    this.lastSampleTime = -1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.traitCtx.clearRect(0, 0, this.traitCanvas.width, this.traitCanvas.height);
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
      max = Math.max(max, d.herbivores, d.predators, d.scavengers, d.insects);
    }
    max *= 1.1;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    const lines: { key: keyof DataPoint; color: string }[] = [
      { key: 'insects', color: '#bb8822' },
      { key: 'scavengers', color: '#ccaa44' },
      { key: 'predators', color: '#cc5544' },
      { key: 'herbivores', color: '#55ddaa' },
    ];

    const step = w / (MAX_POINTS - 1);
    const offsetX = (MAX_POINTS - this.data.length) * step;

    for (const line of lines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = line.color;
      ctx.shadowBlur = 3;
      ctx.beginPath();
      for (let i = 0; i < this.data.length; i++) {
        const x = offsetX + i * step;
        const y = h - (this.data[i][line.key] / max) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Current value labels at right edge with collision avoidance
    if (this.data.length > 0) {
      const latest = this.data[this.data.length - 1];
      const labels: { value: number; color: string; label: string; rawY: number }[] = [
        { value: latest.herbivores, color: '#55ddaa', label: `H: ${latest.herbivores}`, rawY: 0 },
        { value: latest.predators, color: '#cc5544', label: `P: ${latest.predators}`, rawY: 0 },
        { value: latest.scavengers, color: '#ccaa44', label: `S: ${latest.scavengers}`, rawY: 0 },
        { value: latest.insects, color: '#bb8822', label: `I: ${latest.insects}`, rawY: 0 },
      ];
      // Calculate raw Y positions
      for (const lb of labels) {
        const y = h - (lb.value / max) * (h - 4) - 2;
        lb.rawY = Math.max(12, Math.min(h - 4, y)) - 4;
      }
      // Sort by Y position (top to bottom) and space out overlaps
      labels.sort((a, b) => a.rawY - b.rawY);
      const minGap = 14;
      for (let i = 1; i < labels.length; i++) {
        if (labels[i].rawY - labels[i - 1].rawY < minGap) {
          labels[i].rawY = labels[i - 1].rawY + minGap;
        }
      }
      // Clamp back into bounds
      for (const lb of labels) {
        lb.rawY = Math.max(10, Math.min(h - 2, lb.rawY));
      }

      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'right';
      for (const lb of labels) {
        // Dark shadow for readability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillText(lb.label, w - 5, lb.rawY + 1);
        ctx.fillStyle = lb.color;
        ctx.fillText(lb.label, w - 6, lb.rawY);
      }
      ctx.textAlign = 'left';
    }
  }

  private drawTraits(): void {
    const ctx = this.traitCtx;
    const w = this.traitCanvas.width;
    const h = SPARKLINE_HEIGHT;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(10, 10, 15, 0.7)';
    ctx.fillRect(0, 0, w, h);

    if (this.data.length < 2) return;

    // Find max values for each trait to normalize independently
    // Speed and size have very different scales, so normalize each pair
    let maxSpeed = 1;
    let maxSize = 1;
    for (const d of this.data) {
      maxSpeed = Math.max(maxSpeed, d.avgHerbSpeed, d.avgPredSpeed);
      maxSize = Math.max(maxSize, d.avgHerbSize, d.avgPredSize);
    }
    maxSpeed *= 1.1;
    maxSize *= 1.1;

    const traitLines: { key: keyof DataPoint; color: string; max: number }[] = [
      { key: 'avgHerbSpeed', color: '#66ee88', max: maxSpeed },  // light green
      { key: 'avgHerbSize',  color: '#228844', max: maxSize },   // dark green
      { key: 'avgPredSpeed', color: '#ff7766', max: maxSpeed },  // light red
      { key: 'avgPredSize',  color: '#882233', max: maxSize },   // dark red
    ];

    const step = w / (MAX_POINTS - 1);
    const offsetX = (MAX_POINTS - this.data.length) * step;

    // Draw midline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    // Draw label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.font = '9px sans-serif';
    ctx.fillText('Traits', 4, 10);

    for (const line of traitLines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < this.data.length; i++) {
        const x = offsetX + i * step;
        const val = this.data[i][line.key] as number;
        const y = h - (val / line.max) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
