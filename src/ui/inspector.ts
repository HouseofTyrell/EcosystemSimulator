import type { Creature, SimState } from '../sim/types';

const MAX_PINS = 3;

export interface PinnedCreature {
  id: number;
  type: 'herbivore' | 'predator' | 'scavenger';
  deadSince: number | null;
  lastDeathCause: string | null;
}

export class CreatureInspector {
  private panelEl: HTMLDivElement;
  private pinned: PinnedCreature[] = [];
  private energyHistory: Map<number, number[]> = new Map();

  constructor(container: HTMLElement) {
    this.panelEl = document.createElement('div');
    this.panelEl.id = 'inspector';
    container.appendChild(this.panelEl);
  }

  get pinnedIds(): number[] {
    return this.pinned.map(p => p.id);
  }

  tryPin(state: SimState, worldX: number, worldY: number): boolean {
    let bestDist = 20 * 20;
    let bestCreature: Creature | null = null;

    const check = (c: Creature) => {
      const dx = c.pos.x - worldX;
      const dy = c.pos.y - worldY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestCreature = c;
      }
    };

    for (const h of state.herbivores) check(h);
    for (const p of state.predators) check(p);
    for (const s of state.scavengers) check(s);

    if (!bestCreature) return false;

    const c = bestCreature as Creature;
    if (this.pinned.some(p => p.id === c.id)) return true;

    if (this.pinned.length >= MAX_PINS) {
      this.pinned.shift();
    }

    this.pinned.push({ id: c.id, type: c.type, deadSince: null, lastDeathCause: null });
    return true;
  }

  removePin(id: number): void {
    this.pinned = this.pinned.filter(p => p.id !== id);
    this.energyHistory.delete(id);
  }

  clearAll(): void {
    this.pinned = [];
    this.energyHistory.clear();
  }

  /** Auto-pin a random creature if nothing is pinned */
  autoPin(state: SimState): void {
    if (this.pinned.length > 0) return;

    const all: Creature[] = [
      ...state.herbivores,
      ...state.predators,
      ...state.scavengers,
    ];
    if (all.length === 0) return;

    const c = all[Math.floor(Math.random() * all.length)];
    this.pinned.push({ id: c.id, type: c.type, deadSince: null, lastDeathCause: null });
  }

  update(state: SimState, simTime: number): void {
    for (let i = this.pinned.length - 1; i >= 0; i--) {
      const pin = this.pinned[i];
      const creature = this.findCreature(state, pin.id, pin.type);
      if (creature) {
        // Track energy history for sparkline (ring buffer, max 60 entries)
        let hist = this.energyHistory.get(pin.id);
        if (!hist) { hist = []; this.energyHistory.set(pin.id, hist); }
        hist.push(creature.energy);
        if (hist.length > 60) hist.shift();

        // Track death cause while creature is still alive
        if (creature.deathCause) {
          pin.lastDeathCause = creature.deathCause;
        }
      } else {
        if (pin.deadSince === null) pin.deadSince = simTime;
        if (simTime - pin.deadSince! > 3) {
          this.pinned.splice(i, 1);
          this.energyHistory.delete(pin.id);
        }
      }
    }

    this.render(state, simTime);
  }

  private findCreature(state: SimState, id: number, type: string): Creature | undefined {
    if (type === 'herbivore') return state.herbivores.find(h => h.id === id);
    if (type === 'predator') return state.predators.find(p => p.id === id);
    return state.scavengers.find(s => s.id === id);
  }

  private render(state: SimState, simTime: number): void {
    if (this.pinned.length === 0) {
      this.panelEl.innerHTML = '';
      return;
    }

    let html = '';
    for (const pin of this.pinned) {
      const creature = this.findCreature(state, pin.id, pin.type);
      const isDead = !creature;
      const fadeClass = isDead ? ' dead' : '';

      const colors: Record<string, string> = {
        herbivore: '#55ddaa',
        predator: '#cc5544',
        scavenger: '#ccaa44',
      };
      const color = colors[pin.type];
      const label = pin.type.charAt(0).toUpperCase() + pin.type.slice(1);

      if (isDead) {
        const cause = pin.lastDeathCause;
        const causeLabel = cause ? cause.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Dead';

        html += `<div class="inspector-card${fadeClass}">
          <div class="inspector-header" style="color:${color}">
            ${label} #${pin.id}
            <span class="inspector-close" data-id="${pin.id}">&times;</span>
          </div>
          <div class="inspector-dead">${causeLabel}</div>
        </div>`;
      } else {
        const c = creature!;
        const energyPct = Math.max(0, Math.min(100, (c.energy / 100) * 100));
        const agePct = (c.age / c.maxAge * 100).toFixed(0);

        let traitsHtml = '';
        const traits = c.traits as unknown as Record<string, number>;
        for (const [key, val] of Object.entries(traits)) {
          traitsHtml += `<div class="inspector-trait"><span>${key}</span><span>${val.toFixed(1)}</span></div>`;
        }

        const stateHint = c.behavior || 'wandering';

        // Energy sparkline
        const hist = this.energyHistory.get(pin.id);
        let sparklineHtml = '';
        if (hist && hist.length > 2) {
          const maxE = Math.max(...hist, 1);
          const h = 20;
          const w = 60;
          const points = hist.map((e, i) => `${(i / (hist.length - 1)) * w},${h - (e / maxE) * h}`).join(' ');
          sparklineHtml = `<svg class="inspector-sparkline" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1"/></svg>`;
        }

        html += `<div class="inspector-card${fadeClass}">
          <div class="inspector-header" style="color:${color}">
            ${label} #${pin.id}
            <span class="inspector-close" data-id="${pin.id}">&times;</span>
          </div>
          <div class="inspector-energy">
            <div class="inspector-energy-bar" style="width:${energyPct}%;background:${color}"></div>
          </div>
          ${sparklineHtml}
          <div class="inspector-row"><span>Energy</span><span>${c.energy.toFixed(0)}</span></div>
          <div class="inspector-row"><span>Age</span><span>${c.age.toFixed(0)}s / ${c.maxAge.toFixed(0)}s (${agePct}%)</span></div>
          <div class="inspector-row"><span>Lineage</span><span><span class="lineage-swatch" style="background:${color}"></span>#${c.lineageId} gen ${c.generation}</span></div>
          <div class="inspector-row"><span>Offspring</span><span>${c.offspringCount}</span></div>
          <div class="inspector-row"><span>State</span><span>${stateHint}</span></div>
          ${traitsHtml}
        </div>`;
      }
    }

    this.panelEl.innerHTML = html;

    this.panelEl.querySelectorAll('.inspector-close').forEach(el => {
      el.addEventListener('click', (e) => {
        const id = parseInt((e.target as HTMLElement).dataset.id!);
        this.removePin(id);
      });
    });
  }
}
