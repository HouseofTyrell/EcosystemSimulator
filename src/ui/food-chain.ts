// Food Chain Diagram — small HTML canvas overlay showing food web relationships

import type { SimStats } from '../sim/types';
import { makeDraggable } from './draggable';

const WIDTH = 200;
const HEIGHT = 160;
const UPDATE_INTERVAL = 60; // frames between redraws

interface Node {
  label: string;
  color: string;
  x: number;
  y: number;
  radius: number;
  count: number;
}

interface Arrow {
  from: string;
  to: string;
  dotted?: boolean;
}

const ARROWS: Arrow[] = [
  { from: 'Plants', to: 'Herbivores' },
  { from: 'Plants', to: 'Insects' },
  { from: 'Herbivores', to: 'Predators' },
  { from: 'Insects', to: 'Predators' },
  { from: 'Corpses', to: 'Scavengers' },
  { from: 'Bees', to: 'Plants', dotted: true },
];

export class FoodChainDiagram {
  private panel: HTMLDivElement;
  private header: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible: boolean = false;
  private collapsed: boolean = false;
  private frameCount: number = 0;
  private lastStats: SimStats | null = null;

  constructor(container: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.id = 'food-chain';
    this.panel.style.display = 'none';

    this.header = document.createElement('div');
    this.header.className = 'food-chain-header';
    this.header.innerHTML = '<span>Food Web</span><span class="food-chain-toggle">−</span>';
    this.header.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.canvas.style.display = this.collapsed ? 'none' : 'block';
      const icon = this.header.querySelector('.food-chain-toggle')!;
      icon.textContent = this.collapsed ? '+' : '−';
    });
    this.panel.appendChild(this.header);

    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.canvas.className = 'food-chain-canvas';
    this.panel.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    container.appendChild(this.panel);
    makeDraggable(this.panel, this.header);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.panel.style.display = v ? 'block' : 'none';
    if (v && this.lastStats) this.draw(this.lastStats);
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(stats: SimStats): void {
    this.lastStats = stats;
    if (!this.visible || this.collapsed) return;
    this.frameCount++;
    if (this.frameCount % UPDATE_INTERVAL !== 0) return;
    this.draw(stats);
  }

  private nodeRadius(count: number, max: number): number {
    if (max <= 0) return 8;
    const t = Math.min(count / max, 1);
    return 8 + t * 12; // 8–20px
  }

  private draw(stats: SimStats): void {
    const ctx = this.ctx;
    const w = WIDTH;
    const h = HEIGHT;
    ctx.clearRect(0, 0, w, h);

    const totalPop = stats.herbivoreCount + stats.predatorCount + stats.scavengerCount + stats.insectCount;
    const maxPop = Math.max(stats.herbivoreCount, stats.predatorCount, stats.scavengerCount, stats.insectCount, 1);

    // Node positions (hand-tuned layout)
    const nodes: Record<string, Node> = {
      Predators: {
        label: 'Pred', color: '#ee6655',
        x: w * 0.5, y: 20,
        radius: this.nodeRadius(stats.predatorCount, maxPop),
        count: stats.predatorCount,
      },
      Herbivores: {
        label: 'Herb', color: '#55ddaa',
        x: w * 0.25, y: 58,
        radius: this.nodeRadius(stats.herbivoreCount, maxPop),
        count: stats.herbivoreCount,
      },
      Insects: {
        label: 'Ins', color: '#bb8822',
        x: w * 0.75, y: 58,
        radius: this.nodeRadius(stats.insectCount, maxPop),
        count: stats.insectCount,
      },
      Plants: {
        label: 'Plant', color: '#55aa55',
        x: w * 0.5, y: 96,
        radius: this.nodeRadius(Math.round(stats.plantDensity * 100), 100),
        count: Math.round(stats.plantDensity * 100),
      },
      Scavengers: {
        label: 'Scav', color: '#ccaa44',
        x: w * 0.2, y: 134,
        radius: this.nodeRadius(stats.scavengerCount, maxPop),
        count: stats.scavengerCount,
      },
      Corpses: {
        label: 'Dead', color: '#667788',
        x: w * 0.55, y: 134,
        radius: 6,
        count: 0, // no count for corpses
      },
      Bees: {
        label: 'Bee', color: '#ddaa44',
        x: w * 0.82, y: 96,
        radius: Math.max(6, this.nodeRadius(stats.beeCount, maxPop) * 0.7),
        count: stats.beeCount,
      },
    };

    // Draw arrows
    for (const arrow of ARROWS) {
      const from = nodes[arrow.from];
      const to = nodes[arrow.to];
      if (!from || !to) continue;
      this.drawArrow(ctx, from, to, arrow.dotted || false, totalPop);
    }

    // Draw "all die" arrow to corpses (small dashed from center area)
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(102,119,136,0.3)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(w * 0.4, 96);
    ctx.lineTo(nodes.Corpses.x - 6, nodes.Corpses.y - 6);
    ctx.stroke();
    ctx.restore();

    // Draw nodes
    for (const key of Object.keys(nodes)) {
      const node = nodes[key];
      this.drawNode(ctx, node);
    }
  }

  private drawArrow(ctx: CanvasRenderingContext2D, from: Node, to: Node, dotted: boolean, totalPop: number): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const nx = dx / dist;
    const ny = dy / dist;

    // Start/end offset by radius
    const sx = from.x + nx * from.radius;
    const sy = from.y + ny * from.radius;
    const ex = to.x - nx * to.radius;
    const ey = to.y - ny * to.radius;

    // Perpendicular offset for curve
    const px = -ny;
    const py = nx;
    const curveMag = dist * 0.15;

    const mx = (sx + ex) / 2 + px * curveMag;
    const my = (sy + ey) / 2 + py * curveMag;

    // Arrow thickness based on population flow (thin 0.8 to thick 2.5)
    const flowWeight = Math.min(totalPop / 2000, 1);
    const lineWidth = 0.8 + flowWeight * 1.7;

    ctx.save();
    if (dotted) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(221,170,68,0.5)';
      ctx.lineWidth = 1;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(136,153,170,${0.3 + flowWeight * 0.3})`;
      ctx.lineWidth = lineWidth;
    }

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();

    // Arrowhead
    const headLen = 5;
    // Get tangent at endpoint
    const t = 0.95;
    const tangentX = 2 * (1 - t) * (mx - sx) + 2 * t * (ex - mx);
    const tangentY = 2 * (1 - t) * (my - sy) + 2 * t * (ey - my);
    const tLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
    if (tLen < 0.1) { ctx.restore(); return; }
    const tnx = tangentX / tLen;
    const tny = tangentY / tLen;

    ctx.fillStyle = ctx.strokeStyle;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - tnx * headLen + tny * headLen * 0.5, ey - tny * headLen - tnx * headLen * 0.5);
    ctx.lineTo(ex - tnx * headLen - tny * headLen * 0.5, ey - tny * headLen + tnx * headLen * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: Node): void {
    const { x, y, radius, color, label, count } = node;

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#ccddeee0';
    ctx.font = '8px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);

    // Count (below node)
    if (count > 0) {
      ctx.fillStyle = '#8899aa';
      ctx.font = '7px Inter, sans-serif';
      ctx.fillText(String(count), x, y + radius + 7);
    }
  }
}
