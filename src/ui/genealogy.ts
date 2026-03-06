// Genealogy tree panel - shows lineage for a selected creature

import { makeDraggable } from './draggable';
import type { GenealogySnapshot } from '../sim/worker-protocol';

interface TreeNode {
  id: number;
  parentId: number | null;
  type: 'herbivore' | 'predator' | 'scavenger' | 'insect';
  generation: number;
  birthTime: number;
  children: TreeNode[];
  x: number;
  y: number;
}

const TYPE_COLORS: Record<string, string> = {
  herbivore: '#55ddaa',
  predator: '#ee6655',
  scavenger: '#ccaa44',
  insect: '#bb8822',
};

export class GenealogyPanel {
  private panel: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible: boolean = false;
  private currentCreatureId: number | null = null;

  constructor(container: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.id = 'genealogy-panel';
    this.panel.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'genealogy-header';
    header.innerHTML = '<span>Genealogy</span><span class="genealogy-close">&times;</span>';
    this.panel.appendChild(header);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'genealogy-canvas';
    this.canvas.width = 280;
    this.canvas.height = 200;
    this.panel.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    container.appendChild(this.panel);
    makeDraggable(this.panel, header);

    header.querySelector('.genealogy-close')!.addEventListener('click', () => {
      this.hide();
    });
  }

  show(creatureId: number): void {
    this.currentCreatureId = creatureId;
    this.visible = true;
    this.panel.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    this.panel.style.display = 'none';
    this.currentCreatureId = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(genealogy: GenealogySnapshot[], pinnedIds: number[]): void {
    if (!this.visible) return;
    if (pinnedIds.length === 0) {
      this.hide();
      return;
    }

    const targetId = pinnedIds[0];
    if (targetId !== this.currentCreatureId) {
      this.currentCreatureId = targetId;
    }

    this.render(genealogy, targetId);
  }

  private render(genealogy: GenealogySnapshot[], targetId: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (genealogy.length === 0) {
      ctx.fillStyle = '#556677';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No genealogy data yet', w / 2, h / 2);
      return;
    }

    // Build lookup
    const byId = new Map<number, GenealogySnapshot>();
    for (const entry of genealogy) {
      byId.set(entry.id, entry);
    }

    // Find ancestors (walk up)
    const ancestors: GenealogySnapshot[] = [];
    let current = byId.get(targetId);
    while (current) {
      ancestors.unshift(current);
      if (current.parentId !== null && byId.has(current.parentId)) {
        current = byId.get(current.parentId)!;
      } else {
        break;
      }
    }

    // Find children (walk down from target)
    const children: GenealogySnapshot[] = [];
    for (const entry of genealogy) {
      if (entry.parentId === targetId) {
        children.push(entry);
      }
    }

    // Also find siblings (same parent as target)
    const targetEntry = byId.get(targetId);
    const siblings: GenealogySnapshot[] = [];
    if (targetEntry && targetEntry.parentId !== null) {
      for (const entry of genealogy) {
        if (entry.parentId === targetEntry.parentId && entry.id !== targetId) {
          siblings.push(entry);
        }
      }
    }

    // Layout: ancestors in a vertical chain, then target, then children fanning out
    const nodeRadius = 8;
    const verticalGap = 32;
    const horizontalGap = 36;

    // All nodes to draw
    const nodes: TreeNode[] = [];
    const lines: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];

    // Start Y from top
    let currentY = 20;
    const centerX = w / 2;

    // Draw ancestors (top to bottom)
    for (let i = 0; i < ancestors.length; i++) {
      const a = ancestors[i];
      const isTarget = a.id === targetId;
      nodes.push({
        id: a.id,
        parentId: a.parentId,
        type: a.type,
        generation: a.generation,
        birthTime: a.birthTime,
        children: [],
        x: centerX,
        y: currentY,
      });
      if (i > 0) {
        lines.push({
          x1: centerX, y1: currentY - verticalGap + nodeRadius,
          x2: centerX, y2: currentY - nodeRadius,
          color: '#334455',
        });
      }
      if (isTarget) break;
      currentY += verticalGap;
    }

    // If target wasn't in ancestors, add it
    const targetNode = nodes.find(n => n.id === targetId);
    if (!targetNode) {
      nodes.push({
        id: targetId,
        parentId: targetEntry?.parentId ?? null,
        type: targetEntry?.type ?? 'herbivore',
        generation: targetEntry?.generation ?? 0,
        birthTime: targetEntry?.birthTime ?? 0,
        children: [],
        x: centerX,
        y: currentY,
      });
    }

    const targetY = nodes.find(n => n.id === targetId)?.y ?? currentY;

    // Draw siblings on the left
    const sibStartX = centerX - horizontalGap;
    for (let i = 0; i < Math.min(siblings.length, 3); i++) {
      const s = siblings[i];
      const sx = sibStartX - i * (horizontalGap * 0.6);
      const parentNode = nodes.find(n => n.id === s.parentId);
      if (parentNode) {
        lines.push({
          x1: parentNode.x, y1: parentNode.y + nodeRadius,
          x2: sx, y2: targetY - nodeRadius,
          color: '#223344',
        });
      }
      nodes.push({
        id: s.id, parentId: s.parentId, type: s.type,
        generation: s.generation, birthTime: s.birthTime,
        children: [], x: sx, y: targetY,
      });
    }

    // Draw children below
    const childY = targetY + verticalGap;
    const childCount = Math.min(children.length, 7);
    const childStartX = centerX - (childCount - 1) * horizontalGap * 0.5;

    for (let i = 0; i < childCount; i++) {
      const c = children[i];
      const cx = childStartX + i * horizontalGap * 0.5;
      lines.push({
        x1: centerX, y1: targetY + nodeRadius,
        x2: cx, y2: childY - nodeRadius,
        color: '#334455',
      });
      nodes.push({
        id: c.id, parentId: c.parentId, type: c.type,
        generation: c.generation, birthTime: c.birthTime,
        children: [], x: cx, y: childY,
      });
    }

    if (children.length > 7) {
      ctx.fillStyle = '#556677';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`+${children.length - 7} more`, centerX, childY + 20);
    }

    // Draw lines
    for (const line of lines) {
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const isTarget = node.id === targetId;
      const color = TYPE_COLORS[node.type] || '#8899aa';

      ctx.beginPath();
      ctx.arc(node.x, node.y, isTarget ? nodeRadius + 2 : nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = isTarget ? color : 'rgba(10, 12, 20, 0.9)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = isTarget ? 2 : 1;
      ctx.stroke();

      // Label
      ctx.fillStyle = isTarget ? '#ddeeff' : '#8899aa';
      ctx.font = isTarget ? 'bold 9px Inter, sans-serif' : '8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`#${node.id}`, node.x, node.y - nodeRadius - 3);

      // Generation label
      ctx.fillStyle = '#556677';
      ctx.font = '7px Inter, sans-serif';
      ctx.fillText(`g${node.generation}`, node.x, node.y + nodeRadius + 9);
    }

    // Info text at bottom
    ctx.fillStyle = '#556677';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    const info = `${ancestors.length} ancestor${ancestors.length !== 1 ? 's' : ''}, ${children.length} offspring`;
    ctx.fillText(info, 6, h - 6);
  }
}
