import type { Creature, SimState } from '../sim/types';

const MAX_PINS = 3;

export interface PinnedCreature {
  id: number;
  type: 'herbivore' | 'predator' | 'scavenger';
  deadSince: number | null;
}

export class CreatureInspector {
  private panelEl: HTMLDivElement;
  private pinned: PinnedCreature[] = [];

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

    this.pinned.push({ id: c.id, type: c.type, deadSince: null });
    return true;
  }

  removePin(id: number): void {
    this.pinned = this.pinned.filter(p => p.id !== id);
  }

  clearAll(): void {
    this.pinned = [];
  }

  update(state: SimState, simTime: number): void {
    for (let i = this.pinned.length - 1; i >= 0; i--) {
      const pin = this.pinned[i];
      const creature = this.findCreature(state, pin.id, pin.type);
      if (!creature) {
        if (pin.deadSince === null) pin.deadSince = simTime;
        if (simTime - pin.deadSince! > 3) {
          this.pinned.splice(i, 1);
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
        html += `<div class="inspector-card${fadeClass}">
          <div class="inspector-header" style="color:${color}">
            ${label} #${pin.id}
            <span class="inspector-close" data-id="${pin.id}">&times;</span>
          </div>
          <div class="inspector-dead">Dead</div>
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

        let stateHint = 'wandering';
        if (c.energy < 30) stateHint = 'hungry';
        if (c.type === 'herbivore' && c.energy < 15) stateHint = 'starving';
        if (c.type === 'predator' && c.energy < 20) stateHint = 'desperate';

        html += `<div class="inspector-card${fadeClass}">
          <div class="inspector-header" style="color:${color}">
            ${label} #${pin.id}
            <span class="inspector-close" data-id="${pin.id}">&times;</span>
          </div>
          <div class="inspector-energy">
            <div class="inspector-energy-bar" style="width:${energyPct}%;background:${color}"></div>
          </div>
          <div class="inspector-row"><span>Energy</span><span>${c.energy.toFixed(0)}</span></div>
          <div class="inspector-row"><span>Age</span><span>${c.age.toFixed(0)}s / ${c.maxAge.toFixed(0)}s (${agePct}%)</span></div>
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
