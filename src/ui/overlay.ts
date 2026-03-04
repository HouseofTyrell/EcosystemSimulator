// UI overlay: stats, help, settings, keyboard controls

import type { SimStats, SimConfig } from '../sim/types';

export interface UICallbacks {
  onPause: () => void;
  onResume: () => void;
  onResetSameSeed: () => void;
  onNewSeed: () => void;
  onSpeedChange: (speed: number) => void;
  onConfigChange: (key: string, value: number | boolean) => void;
  isPaused: () => boolean;
  getSpeed: () => number;
  getSeed: () => number;
}

export class UIOverlay {
  private overlay: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private helpEl: HTMLDivElement;
  private settingsEl: HTMLDivElement;
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

    // Speed indicator
    this.speedEl = document.createElement('div');
    this.speedEl.id = 'speed-indicator';
    this.overlay.appendChild(this.speedEl);

    // Pause indicator
    this.pauseEl = document.createElement('div');
    this.pauseEl.id = 'pause-indicator';
    this.pauseEl.textContent = 'PAUSED';
    this.overlay.appendChild(this.pauseEl);

    // Seed display
    this.seedEl = document.createElement('div');
    this.seedEl.id = 'seed-display';
    this.overlay.appendChild(this.seedEl);

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
      <div><span class="key">T</span> Toggle trails</div>
      <div><span class="key">E</span> Toggle trait sparklines</div>
      <div><span class="key">G</span> Toggle graph</div>
      <div><span class="key">F</span> Toggle event feed</div>
      <div><span class="key">Esc</span> Clear inspector</div>
      <div><span class="key">M</span> Toggle sound</div>
      <div><span class="key">H</span> Toggle this help</div>
      <div><span class="key">S</span> Toggle settings</div>
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

    // Overlay always visible by default (no auto-fade)
  }

  private buildSettings(): void {
    const cb = this.callbacks;

    this.settingsEl.innerHTML = `
      <div class="settings-header">
        <span>Settings</span>
        <span class="toggle-icon">+</span>
      </div>
      <div class="settings-body">
        <div class="settings-section-label">Display</div>
        <div class="setting-toggle-row">
          <label>Stats</label>
          <input type="checkbox" checked data-toggle="stats" />
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
          <label>Graph</label>
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
          <label>Help</label>
          <input type="checkbox" data-toggle="help" />
        </div>
        <div class="setting-toggle-row">
          <label>Day/Night</label>
          <input type="checkbox" checked data-toggle="daynight" />
        </div>
        <div class="setting-toggle-row">
          <label>Weather</label>
          <input type="checkbox" checked data-toggle="weather" />
        </div>
        <div class="setting-toggle-row">
          <label>World Wrap</label>
          <input type="checkbox" data-toggle="wrapWorld" />
        </div>
        <div class="setting-toggle-row">
          <label>Sound</label>
          <input type="checkbox" data-toggle="sound" />
        </div>
        <div class="settings-divider"></div>
        <div class="settings-section-label">Simulation</div>
        <div class="setting-row">
          <label>Mutation Rate</label>
          <input type="range" min="0" max="40" value="10" data-key="mutationRate" data-scale="0.01" />
          <span class="val">0.10</span>
        </div>
        <div class="setting-row">
          <label>Season Strength</label>
          <input type="range" min="0" max="80" value="40" data-key="seasonalStrength" data-scale="0.01" />
          <span class="val">0.40</span>
        </div>
        <div class="setting-row">
          <label>Plant Growth</label>
          <input type="range" min="5" max="100" value="20" data-key="plantGrowthRate" data-scale="0.01" />
          <span class="val">0.20</span>
        </div>
        <div class="setting-row">
          <label>Big Mutations</label>
          <input type="range" min="0" max="1" value="0" data-key="bigMutationEnabled" data-scale="1" data-bool="true" />
          <span class="val">Off</span>
        </div>
        <div class="settings-divider"></div>
        <div class="settings-section-label">Balance</div>
        <div class="setting-row">
          <label>Herb Repro Energy</label>
          <input type="range" min="40" max="160" value="105" data-key="herbivoreReproductionEnergy" data-scale="1" />
          <span class="val">105</span>
        </div>
        <div class="setting-row">
          <label>Pred Repro Energy</label>
          <input type="range" min="50" max="200" value="130" data-key="predatorReproductionEnergy" data-scale="1" />
          <span class="val">130</span>
        </div>
        <div class="setting-row">
          <label>Scav Repro Energy</label>
          <input type="range" min="30" max="120" value="80" data-key="scavengerReproductionEnergy" data-scale="1" />
          <span class="val">80</span>
        </div>
        <div class="setting-row">
          <label>Pred Attack Energy</label>
          <input type="range" min="20" max="80" value="40" data-key="predatorAttackEnergy" data-scale="1" />
          <span class="val">40</span>
        </div>
        <div class="setting-row">
          <label>Herb Max Age</label>
          <input type="range" min="30" max="120" value="60" data-key="herbivoreMaxAge" data-scale="1" />
          <span class="val">60</span>
        </div>
        <div class="setting-row">
          <label>Pred Max Age</label>
          <input type="range" min="25" max="100" value="50" data-key="predatorMaxAge" data-scale="1" />
          <span class="val">50</span>
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
        } else {
          // graph, traits, feed — handled by main via onConfigChange
          cb.onConfigChange(key, el.checked);
        }
      });
    });
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
        case 'KeyM':
          cb.onConfigChange('sound', true);
          this.syncToggle('sound', !this.getToggleState('sound'));
          break;
        case 'Escape':
          cb.onConfigChange('inspector', true);
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

  updateStats(stats: SimStats, simTime: number): void {
    this.statsEl.innerHTML = `
      <div><span class="label">Time:</span> <span class="value">${this.formatTime(simTime)}</span></div>
      <div><span class="label">Season:</span> <span class="season">${stats.seasonName}</span></div>
      <div><span class="label">Period:</span> <span class="value">${stats.timeOfDay}</span></div>
      <div><span class="label">Weather:</span> <span class="value">${stats.weatherName}</span></div>
      <div><span class="label">Event:</span> <span class="value">${stats.activeEventName !== 'none' ? stats.activeEventName.charAt(0).toUpperCase() + stats.activeEventName.slice(1) : '\u2014'}</span></div>
      <div><span class="label">Plants:</span> <span class="plant">${stats.plantDensity.toFixed(2)}</span></div>
      <div><span class="label">Herbivores:</span> <span class="herbivore">${stats.herbivoreCount}</span></div>
      <div><span class="label">Predators:</span> <span class="predator">${stats.predatorCount}</span></div>
      <div><span class="label">Scavengers:</span> <span class="value" style="color: #ccaa44">${stats.scavengerCount}</span></div>
      <div><span class="label">Max Gen:</span> <span class="value">${stats.maxGeneration}</span></div>
      <div style="margin-top: 6px;">
        <span class="label">Herb avg:</span>
        <span class="herbivore">spd ${stats.avgHerbivoreSpeed.toFixed(0)} size ${stats.avgHerbivoreSize.toFixed(1)} vis ${stats.avgHerbivoreVision.toFixed(0)}</span>
      </div>
      <div>
        <span class="label">Pred avg:</span>
        <span class="predator">spd ${stats.avgPredatorSpeed.toFixed(0)} size ${stats.avgPredatorSize.toFixed(1)} vis ${stats.avgPredatorVision.toFixed(0)}</span>
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
}
