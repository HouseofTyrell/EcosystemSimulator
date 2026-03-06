// UI overlay: stats, help, settings, keyboard controls

import type { SimStats, SimConfig } from '../sim/types';
import { makeDraggable, resetPanelPositions } from './draggable';

export interface UICallbacks {
  onPause: () => void;
  onResume: () => void;
  onResetSameSeed: () => void;
  onNewSeed: () => void;
  onSpeedChange: (speed: number) => void;
  onConfigChange: (key: string, value: number | boolean) => void;
  onResetCamera: () => void;
  onSave: (slot: number) => void;
  onLoad: (slot: number) => void;
  onExport: () => void;
  onImport: (data: object) => void;
  onToolMode: (mode: string) => void;
  isPaused: () => boolean;
  getSpeed: () => number;
  getSeed: () => number;
}

export class UIOverlay {
  private overlay: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private helpEl: HTMLDivElement;
  private settingsEl: HTMLDivElement;
  private bottomStatus: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private pauseEl: HTMLDivElement;
  private seedEl: HTMLDivElement;
  private callbacks: UICallbacks;
  private settingsCollapsed: boolean = true;
  private helpVisible: boolean = false;

  constructor(container: HTMLElement, callbacks: UICallbacks) {
    this.callbacks = callbacks;

    // Main overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay';
    container.appendChild(this.overlay);

    // Stats
    this.statsEl = document.createElement('div');
    this.statsEl.id = 'stats';
    this.overlay.appendChild(this.statsEl);

    // Bottom status bar (speed + seed combined)
    this.bottomStatus = document.createElement('div');
    this.bottomStatus.id = 'bottom-status';
    this.overlay.appendChild(this.bottomStatus);

    this.speedEl = document.createElement('div');
    this.speedEl.id = 'speed-indicator';
    this.bottomStatus.appendChild(this.speedEl);

    this.seedEl = document.createElement('div');
    this.seedEl.id = 'seed-display';
    this.bottomStatus.appendChild(this.seedEl);

    // Separator
    const sep1 = document.createElement('div');
    sep1.className = 'status-sep';
    this.bottomStatus.appendChild(sep1);

    // Tool buttons - visible entry points for paint/spawn
    const paintBtn = document.createElement('button');
    paintBtn.className = 'status-tool-btn';
    paintBtn.id = 'status-paint-btn';
    paintBtn.innerHTML = '<span class="btn-icon">\u270E</span> Paint';
    paintBtn.title = 'Paint terrain (P)';
    paintBtn.addEventListener('click', () => callbacks.onToolMode('paint'));
    this.bottomStatus.appendChild(paintBtn);

    const spawnBtn = document.createElement('button');
    spawnBtn.className = 'status-tool-btn';
    spawnBtn.id = 'status-spawn-btn';
    spawnBtn.innerHTML = '<span class="btn-icon">\u2726</span> Spawn';
    spawnBtn.title = 'Spawn creatures (B)';
    spawnBtn.addEventListener('click', () => callbacks.onToolMode('spawn'));
    this.bottomStatus.appendChild(spawnBtn);

    const sep2 = document.createElement('div');
    sep2.className = 'status-sep';
    this.bottomStatus.appendChild(sep2);

    const shareBtn = document.createElement('button');
    shareBtn.className = 'status-tool-btn';
    shareBtn.textContent = 'Share';
    shareBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(callbacks.getSeed()));
      navigator.clipboard.writeText(url.toString()).then(() => {
        shareBtn.textContent = 'Copied!';
        setTimeout(() => { shareBtn.textContent = 'Share'; }, 1500);
      });
    });
    this.bottomStatus.appendChild(shareBtn);

    const resetCamBtn = document.createElement('button');
    resetCamBtn.className = 'status-tool-btn';
    resetCamBtn.textContent = 'Reset View';
    resetCamBtn.addEventListener('click', () => callbacks.onResetCamera());
    this.bottomStatus.appendChild(resetCamBtn);

    // Pause indicator
    this.pauseEl = document.createElement('div');
    this.pauseEl.id = 'pause-indicator';
    this.pauseEl.textContent = 'PAUSED';
    this.overlay.appendChild(this.pauseEl);

    // Help
    this.helpEl = document.createElement('div');
    this.helpEl.id = 'help';
    this.helpEl.innerHTML = `
      <h2>Controls</h2>
      <div><span class="key">Space</span> Pause / Resume</div>
      <div><span class="key">R</span> Reset (same seed)</div>
      <div><span class="key">N</span> New random seed</div>
      <div><span class="key">1</span> Speed 0.5x</div>
      <div><span class="key">2</span> Speed 1x</div>
      <div><span class="key">3</span> Speed 2x</div>
      <div><span class="key">4</span> Speed 4x</div>
      <div><span class="key">5</span> Speed 10x</div>
      <div><span class="key">6</span> Speed 20x</div>
      <div><span class="key">T</span> Toggle trails</div>
      <div><span class="key">E</span> Toggle trait sparklines</div>
      <div><span class="key">G</span> Toggle graph</div>
      <div><span class="key">F</span> Toggle event feed</div>
      <div><span class="key">W</span> Toggle food web</div>
      <div><span class="key">Esc</span> Clear inspector</div>
      <div><span class="key">M</span> Toggle sound</div>
      <div><span class="key">P</span> Paint terrain tool</div>
      <div><span class="key">B</span> Spawn creatures tool</div>
      <div><span class="key">H</span> Toggle this help</div>
      <div><span class="key">S</span> Toggle settings</div>
      <div><span class="key">0</span> Reset camera</div>
      <div><span class="key">L</span> Reset panel layout</div>
    `;
    this.overlay.appendChild(this.helpEl);

    // Settings panel
    this.settingsEl = document.createElement('div');
    this.settingsEl.id = 'settings';
    // Settings starts expanded so users can discover display toggles
    this.buildSettings();
    this.settingsEl.classList.add('collapsed');
    this.overlay.appendChild(this.settingsEl);

    // Key bindings
    this.setupKeyboard();

    // Make panels draggable
    makeDraggable(this.statsEl, this.statsEl);
    makeDraggable(this.settingsEl, this.settingsEl.querySelector('.settings-header')! as HTMLElement);

    // Overlay always visible by default (no auto-fade)
  }

  private buildSettings(): void {
    const cb = this.callbacks;

    this.settingsEl.innerHTML = `
      <div class="settings-header">
        <span>\u2699 Settings</span>
        <span class="toggle-icon">+</span>
      </div>
      <div class="settings-body">

        <div class="settings-section" data-section="view">
          <div class="settings-section-header">
            <span>View</span>
            <span class="section-toggle">\u25BE</span>
          </div>
          <div class="settings-section-content">
            <div class="setting-toggle-row">
              <label>Stats Panel</label>
              <input type="checkbox" checked data-toggle="stats" />
            </div>
            <div class="setting-toggle-row">
              <label>Population Graph</label>
              <input type="checkbox" checked data-toggle="graph" />
            </div>
            <div class="setting-toggle-row">
              <label>Trait Sparklines</label>
              <input type="checkbox" data-toggle="traits" />
            </div>
            <div class="setting-toggle-row">
              <label>Event Feed</label>
              <input type="checkbox" checked data-toggle="feed" />
            </div>
            <div class="setting-toggle-row">
              <label>Food Web</label>
              <input type="checkbox" data-toggle="foodweb" />
            </div>
            <div class="setting-toggle-row">
              <label>Genealogy Tree</label>
              <input type="checkbox" data-toggle="genealogy" />
            </div>
            <div class="setting-toggle-row">
              <label>Territories</label>
              <input type="checkbox" checked data-toggle="territories" />
            </div>
            <div class="setting-toggle-row">
              <label>Trails</label>
              <input type="checkbox" data-toggle="trails" />
            </div>
            <div class="setting-row">
              <label>Trail Fade</label>
              <input type="range" min="1" max="20" value="3" data-key="trailFade" data-scale="0.01" />
              <span class="val">0.03</span>
            </div>
            <div class="setting-toggle-row">
              <label>Day/Night Cycle</label>
              <input type="checkbox" checked data-toggle="daynight" />
            </div>
            <div class="setting-toggle-row">
              <label>Weather Effects</label>
              <input type="checkbox" checked data-toggle="weather" />
            </div>
            <div class="setting-toggle-row">
              <label>Sound</label>
              <input type="checkbox" data-toggle="sound" />
            </div>
            <div class="setting-toggle-row">
              <label>Keyboard Help</label>
              <input type="checkbox" data-toggle="help" />
            </div>
          </div>
        </div>

        <div class="settings-section" data-section="world">
          <div class="settings-section-header">
            <span>World</span>
            <span class="section-toggle">\u25B8</span>
          </div>
          <div class="settings-section-content collapsed-section">
            <div class="setting-row">
              <label>World Size</label>
              <select data-key="worldSize">
                <option value="small">Small (2000)</option>
                <option value="medium" selected>Medium (4000)</option>
                <option value="large">Large (6000)</option>
              </select>
            </div>
            <div class="setting-toggle-row">
              <label>World Wrap</label>
              <input type="checkbox" data-toggle="wrapWorld" />
            </div>
            <div class="setting-row">
              <label>Plant Growth</label>
              <input type="range" min="5" max="100" value="35" data-key="plantGrowthRate" data-scale="0.01" />
              <span class="val">0.35</span>
            </div>
            <div class="setting-row">
              <label>Season Strength</label>
              <input type="range" min="0" max="80" value="40" data-key="seasonalStrength" data-scale="0.01" />
              <span class="val">0.40</span>
            </div>
            <div class="setting-row">
              <label>Mutation Rate</label>
              <input type="range" min="0" max="40" value="10" data-key="mutationRate" data-scale="0.01" />
              <span class="val">0.10</span>
            </div>
            <div class="setting-row">
              <label>Big Mutations</label>
              <input type="range" min="0" max="1" value="0" data-key="bigMutationEnabled" data-scale="1" data-bool="true" />
              <span class="val">Off</span>
            </div>
          </div>
        </div>

        <div class="settings-section" data-section="balance">
          <div class="settings-section-header">
            <span>Balance</span>
            <span class="section-toggle">\u25B8</span>
          </div>
          <div class="settings-section-content collapsed-section">
            <div class="setting-row">
              <label>Herb Repro Energy</label>
              <input type="range" min="40" max="160" value="80" data-key="herbivoreReproductionEnergy" data-scale="1" />
              <span class="val">80</span>
            </div>
            <div class="setting-row">
              <label>Pred Repro Energy</label>
              <input type="range" min="50" max="200" value="100" data-key="predatorReproductionEnergy" data-scale="1" />
              <span class="val">100</span>
            </div>
            <div class="setting-row">
              <label>Scav Repro Energy</label>
              <input type="range" min="30" max="120" value="60" data-key="scavengerReproductionEnergy" data-scale="1" />
              <span class="val">60</span>
            </div>
            <div class="setting-row">
              <label>Pred Attack Energy</label>
              <input type="range" min="20" max="80" value="40" data-key="predatorAttackEnergy" data-scale="1" />
              <span class="val">40</span>
            </div>
            <div class="setting-row">
              <label>Herb Max Age</label>
              <input type="range" min="30" max="300" value="120" data-key="herbivoreMaxAge" data-scale="1" />
              <span class="val">120</span>
            </div>
            <div class="setting-row">
              <label>Pred Max Age</label>
              <input type="range" min="25" max="250" value="100" data-key="predatorMaxAge" data-scale="1" />
              <span class="val">100</span>
            </div>
          </div>
        </div>

        <div class="settings-section" data-section="saveload">
          <div class="settings-section-header">
            <span>Save / Load</span>
            <span class="section-toggle">\u25B8</span>
          </div>
          <div class="settings-section-content collapsed-section">
            <div class="save-load-slots">
              <div class="save-slot-row">
                <span class="slot-label">Slot 1</span>
                <button class="sl-btn" data-action="save" data-slot="1">Save</button>
                <button class="sl-btn" data-action="load" data-slot="1">Load</button>
              </div>
              <div class="save-slot-row">
                <span class="slot-label">Slot 2</span>
                <button class="sl-btn" data-action="save" data-slot="2">Save</button>
                <button class="sl-btn" data-action="load" data-slot="2">Load</button>
              </div>
              <div class="save-slot-row">
                <span class="slot-label">Slot 3</span>
                <button class="sl-btn" data-action="save" data-slot="3">Save</button>
                <button class="sl-btn" data-action="load" data-slot="3">Load</button>
              </div>
            </div>
            <div class="save-slot-row" style="margin-top:6px;">
              <button class="sl-btn sl-wide" data-action="export">Export JSON</button>
              <button class="sl-btn sl-wide" data-action="import">Import JSON</button>
              <input type="file" accept=".json" class="sl-file-input" style="display:none" />
            </div>
          </div>
        </div>

      </div>
    `;

    // Header toggle
    const header = this.settingsEl.querySelector('.settings-header')!;
    header.addEventListener('click', () => {
      this.settingsCollapsed = !this.settingsCollapsed;
      this.settingsEl.classList.toggle('collapsed', this.settingsCollapsed);
      const icon = this.settingsEl.querySelector('.toggle-icon')!;
      icon.textContent = this.settingsCollapsed ? '+' : '−';
    });

    // Sub-section toggles
    this.settingsEl.querySelectorAll('.settings-section-header').forEach(sh => {
      sh.addEventListener('click', (e) => {
        e.stopPropagation();
        const section = (sh as HTMLElement).parentElement!;
        const content = section.querySelector('.settings-section-content')!;
        const arrow = section.querySelector('.section-toggle')!;
        content.classList.toggle('collapsed-section');
        arrow.textContent = content.classList.contains('collapsed-section') ? '\u25B8' : '\u25BE';
      });
    });

    // Sliders
    const sliders = this.settingsEl.querySelectorAll('input[type="range"]');
    sliders.forEach((input) => {
      const el = input as HTMLInputElement;
      el.addEventListener('input', () => {
        const key = el.dataset.key!;
        const scale = parseFloat(el.dataset.scale || '1');
        const isBool = el.dataset.bool === 'true';
        const rawVal = parseFloat(el.value);
        const val = isBool ? rawVal > 0.5 : rawVal * scale;
        const valSpan = el.parentElement!.querySelector('.val')!;
        if (isBool) {
          valSpan.textContent = val ? 'On' : 'Off';
        } else {
          valSpan.textContent = (val as number).toFixed(2);
        }
        cb.onConfigChange(key, val);
      });
    });

    // World size select
    const worldSelect = this.settingsEl.querySelector('select[data-key="worldSize"]') as HTMLSelectElement | null;
    if (worldSelect) {
      worldSelect.addEventListener('change', () => {
        cb.onConfigChange('worldSize', worldSelect.value as unknown as number);
      });
    }

    // Display toggles
    const toggles = this.settingsEl.querySelectorAll('input[type="checkbox"]');
    toggles.forEach((input) => {
      const el = input as HTMLInputElement;
      el.addEventListener('change', () => {
        const key = el.dataset.toggle!;
        if (key === 'stats') {
          this.statsEl.style.display = el.checked ? 'block' : 'none';
        } else if (key === 'help') {
          this.helpVisible = el.checked;
          this.helpEl.classList.toggle('visible', el.checked);
        } else if (key === 'trails') {
          cb.onConfigChange('trails', true);
        } else if (key === 'wrapWorld') {
          cb.onConfigChange('wrapWorld', el.checked);
        } else if (key === 'genealogy') {
          cb.onConfigChange('genealogy', el.checked);
        } else {
          // graph, traits, feed — handled by main via onConfigChange
          cb.onConfigChange(key, el.checked);
        }
      });
    });

    // Save/Load buttons
    const slButtons = this.settingsEl.querySelectorAll('.sl-btn');
    slButtons.forEach((btn) => {
      const el = btn as HTMLButtonElement;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        const slot = parseInt(el.dataset.slot || '0', 10);
        if (action === 'save' && slot > 0) {
          cb.onSave(slot);
          el.textContent = 'Saved!';
          setTimeout(() => { el.textContent = 'Save'; }, 1200);
        } else if (action === 'load' && slot > 0) {
          cb.onLoad(slot);
        } else if (action === 'export') {
          cb.onExport();
        } else if (action === 'import') {
          const fileInput = this.settingsEl.querySelector('.sl-file-input') as HTMLInputElement;
          fileInput.click();
        }
      });
    });

    // File import handler
    const fileInput = this.settingsEl.querySelector('.sl-file-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result as string);
            cb.onImport(data);
          } catch (e) {
            console.error('Failed to parse save file:', e);
          }
        };
        reader.readAsText(file);
        fileInput.value = '';
      });
    }
  }

  private setupKeyboard(): void {
    const cb = this.callbacks;
    window.addEventListener('keydown', (e) => {
      // Don't capture if user is in an input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          cb.isPaused() ? cb.onResume() : cb.onPause();
          break;
        case 'KeyR':
          cb.onResetSameSeed();
          break;
        case 'KeyN':
          cb.onNewSeed();
          break;
        case 'Digit1':
          cb.onSpeedChange(0.5);
          break;
        case 'Digit2':
          cb.onSpeedChange(1);
          break;
        case 'Digit3':
          cb.onSpeedChange(2);
          break;
        case 'Digit4':
          cb.onSpeedChange(4);
          break;
        case 'Digit5':
          cb.onSpeedChange(10);
          break;
        case 'Digit6':
          cb.onSpeedChange(20);
          break;
        case 'KeyH':
          this.toggleHelp();
          this.syncToggle('help', this.helpVisible);
          break;
        case 'KeyS':
          this.settingsCollapsed = !this.settingsCollapsed;
          this.settingsEl.classList.toggle('collapsed', this.settingsCollapsed);
          const icon = this.settingsEl.querySelector('.toggle-icon')!;
          icon.textContent = this.settingsCollapsed ? '+' : '−';
          break;
        case 'KeyT':
          cb.onConfigChange('trails', true); // toggled by main
          this.syncToggle('trails', !this.getToggleState('trails'));
          break;
        case 'KeyE':
          cb.onConfigChange('traits', true);
          this.syncToggle('traits', !this.getToggleState('traits'));
          break;
        case 'KeyG':
          cb.onConfigChange('graph', true);
          this.syncToggle('graph', !this.getToggleState('graph'));
          break;
        case 'KeyF':
          cb.onConfigChange('feed', true);
          this.syncToggle('feed', !this.getToggleState('feed'));
          break;
        case 'KeyW':
          cb.onConfigChange('foodweb', true);
          this.syncToggle('foodweb', !this.getToggleState('foodweb'));
          break;
        case 'KeyM':
          cb.onConfigChange('sound', true);
          this.syncToggle('sound', !this.getToggleState('sound'));
          break;
        case 'Escape':
          cb.onConfigChange('inspector', true);
          break;
        case 'KeyL':
          resetPanelPositions();
          break;
      }

      this.showOverlay();
    });
  }

  private showOverlay(): void {
    this.overlay.classList.remove('hidden');
  }

  syncToggle(key: string, checked: boolean): void {
    const el = this.settingsEl.querySelector(`input[data-toggle="${key}"]`) as HTMLInputElement | null;
    if (el) el.checked = checked;
  }

  private getToggleState(key: string): boolean {
    const el = this.settingsEl.querySelector(`input[data-toggle="${key}"]`) as HTMLInputElement | null;
    return el ? el.checked : false;
  }

  private toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
    this.helpEl.classList.toggle('visible', this.helpVisible);
  }

  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  updateStats(stats: SimStats, simTime: number, fps?: number): void {
    const eventName = stats.activeEventName !== 'none'
      ? stats.activeEventName.charAt(0).toUpperCase() + stats.activeEventName.slice(1)
      : '';
    this.statsEl.innerHTML = `
      <div class="stats-row-top">
        <span class="value">${this.formatTime(simTime)}</span>
        <span class="season">${stats.seasonName}</span>
        <span class="value">${stats.weatherName !== 'Clear' ? stats.weatherName : ''}</span>
        ${fps !== undefined ? `<span class="fps-value">${fps} fps</span>` : ''}
      </div>
      ${eventName ? `<div class="stats-event">${eventName}</div>` : ''}
      <div class="stats-populations">
        <div><span class="herbivore">${stats.herbivoreCount}</span> <span class="label">herb</span> <span class="sub-detail">${stats.grazerCount}g ${stats.foragerCount}f</span></div>
        <div><span class="predator">${stats.predatorCount}</span> <span class="label">pred</span> <span class="sub-detail">${stats.stalkerCount}s ${stats.packHunterCount}p</span></div>
        <div><span class="scavenger-count">${stats.scavengerCount}</span> <span class="label">scav</span> <span class="sub-detail">${stats.vultureCount}v ${stats.beetleCount}b</span></div>
        <div><span class="insect-count">${stats.insectCount}</span> <span class="label">insect</span> <span class="sub-detail">${stats.antCount}a ${stats.beeCount}b</span></div>
      </div>
      <div class="stats-footer">
        <span class="label">gen ${stats.maxGeneration}</span>
        <span class="plant">${stats.plantDensity.toFixed(2)}</span> <span class="label">plants</span>
      </div>
    `;
  }

  updateSpeed(speed: number): void {
    this.speedEl.textContent = `Speed: ${speed}x`;
  }

  updatePaused(paused: boolean): void {
    this.pauseEl.classList.toggle('visible', paused);
    if (paused) {
      this.showOverlay();
    }
  }

  updateSeed(seed: number): void {
    this.seedEl.textContent = `seed: ${seed}`;
  }

  updateToolMode(mode: string): void {
    const paintBtn = document.getElementById('status-paint-btn');
    const spawnBtn = document.getElementById('status-spawn-btn');
    if (paintBtn) paintBtn.classList.toggle('active', mode === 'paint');
    if (spawnBtn) spawnBtn.classList.toggle('active', mode === 'spawn');
  }
}
