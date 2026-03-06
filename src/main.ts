// Main entry point - wires simulation, renderer, and UI together

import { SimWorkerClient } from './sim/sim-worker-client';
import { Renderer } from './render/renderer';
import { UIOverlay } from './ui/overlay';
import { PopulationGraph } from './ui/graph';
import { CreatureInspector } from './ui/inspector';
import { EventFeed } from './ui/feed';
import { Camera } from './camera';
import { Tooltip } from './ui/tooltip';
import { Minimap } from './ui/minimap';
import { AudioManager } from './audio/audio-manager';
import { FoodChainDiagram } from './ui/food-chain';
import { GenealogyPanel } from './ui/genealogy';
import { clampAllPanels, makeDraggable } from './ui/draggable';

const SIM_DT = 1 / 60; // Fixed timestep: 60Hz

type ToolMode = 'none' | 'paint' | 'spawn';
type TerrainBrush = 0 | 1 | 2 | 3; // normal, water, fertile, mountain
type StampType = 'lake' | 'river' | 'mountainRange' | null;
type SpawnType = 'herbivore' | 'predator' | 'scavenger' | 'insect';

class App {
  private sim: SimWorkerClient;
  private renderer: Renderer;
  private ui!: UIOverlay;
  private graph!: PopulationGraph;
  private inspector!: CreatureInspector;
  private feed!: EventFeed;
  private foodChain!: FoodChainDiagram;
  private genealogy!: GenealogyPanel;
  private camera!: Camera;
  private tooltip!: Tooltip;
  private minimap!: Minimap;
  private audio: AudioManager = new AudioManager();
  private lastFeedCount: number = 0;
  private paused: boolean = false;
  private speed: number = 4;
  private trails: boolean = false;
  private dayNightEnabled: boolean = true;
  private accumulator: number = 0;
  private lastTime: number = 0;
  private seed: number;
  private fpsFrames: number = 0;
  private fpsLastTime: number = 0;
  private fps: number = 0;
  private perfFactor: number = 1.0; // 1.0 = full caps, 0.0 = minimum caps

  // Tool mode state
  private toolMode: ToolMode = 'none';
  private paintBrush: TerrainBrush = 1; // default: water
  private paintRadius: number = 3; // 1, 3, or 5
  private stampType: StampType = null;
  private spawnType: SpawnType = 'herbivore';
  private isPainting: boolean = false;
  private toolbarEl: HTMLDivElement | null = null;
  private cursorIndicator: HTMLDivElement | null = null;
  private genealogyEnabled: boolean = false;

  constructor() {
    // Read seed from URL if present, otherwise random
    const urlParams = new URLSearchParams(window.location.search);
    const urlSeed = urlParams.get('seed');
    this.seed = urlSeed ? parseInt(urlSeed, 10) : Math.floor(Math.random() * 999999);
    if (isNaN(this.seed)) this.seed = Math.floor(Math.random() * 999999);
    this.sim = new SimWorkerClient({ seed: this.seed });
    this.renderer = new Renderer();
  }

  async start(): Promise<void> {
    await this.sim.waitForReady();
    const container = document.getElementById('app')!;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const worldW = this.sim.renderState.config.worldWidth;
    const worldH = this.sim.renderState.config.worldHeight;

    this.camera = new Camera(worldW, worldH, width, height);

    await this.renderer.init({
      container,
      width,
      height,
      worldWidth: worldW,
      worldHeight: worldH,
      trails: this.trails,
    });

    this.ui = new UIOverlay(container, {
      onPause: () => { this.paused = true; this.ui.updatePaused(true); },
      onResume: () => { this.paused = false; this.ui.updatePaused(false); },
      onResetSameSeed: () => this.reset(this.seed),
      onNewSeed: () => {
        this.seed = Math.floor(Math.random() * 999999);
        this.reset(this.seed);
      },
      onSpeedChange: (s) => { this.speed = s; this.ui.updateSpeed(s); },
      onConfigChange: (key, value) => this.handleConfigChange(key, value),
      onResetCamera: () => this.camera.resetView(),
      onSave: (slot) => this.saveToSlot(slot),
      onLoad: (slot) => this.loadFromSlot(slot),
      onExport: () => this.exportJSON(),
      onImport: (data) => this.importJSON(data),
      onToolMode: (mode) => this.setToolMode(mode as ToolMode),
      isPaused: () => this.paused,
      getSpeed: () => this.speed,
      getSeed: () => this.seed,
    });

    this.ui.updateSpeed(this.speed);
    this.ui.updateSeed(this.seed);

    // Update URL with current seed (without reload)
    this.updateURL();

    this.graph = new PopulationGraph(container);
    makeDraggable(this.graph.getPanel(), this.graph.getHeader());

    this.inspector = new CreatureInspector(container);

    this.feed = new EventFeed(container);

    this.foodChain = new FoodChainDiagram(container);

    this.genealogy = new GenealogyPanel(container);

    this.tooltip = new Tooltip(document.body);

    this.minimap = new Minimap(document.body);
    this.minimap.onClick((x, y) => this.camera.centerOn(x, y), this.sim.renderState.config);

    this.renderer.app.canvas.addEventListener('click', (e) => {
      if (!this.audio.isEnabled) this.audio.init();
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
      const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);
      // Tool modes intercept clicks
      if (this.handleToolClick(worldX, worldY, e.shiftKey)) return;
      this.inspector.tryPin(this.sim.renderState as any, worldX, worldY);
    });

    // Paint mode: drag to paint
    this.renderer.app.canvas.addEventListener('mousedown', (e) => {
      if (this.toolMode === 'paint' && e.button === 0) {
        this.isPainting = true;
        const rect = this.renderer.app.canvas.getBoundingClientRect();
        const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
        const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);
        if (this.stampType) {
          this.applyStamp(worldX, worldY);
        } else {
          this.paintAt(worldX, worldY);
        }
      }
    });
    this.renderer.app.canvas.addEventListener('mousemove', (e) => {
      // Update cursor indicator position
      if (this.cursorIndicator && this.toolMode === 'paint') {
        this.updateCursorSize();
        this.cursorIndicator.style.left = `${e.clientX}px`;
        this.cursorIndicator.style.top = `${e.clientY}px`;
      }
      // Drag painting (only brush, not stamps)
      if (this.isPainting && this.toolMode === 'paint' && !this.stampType) {
        const rect = this.renderer.app.canvas.getBoundingClientRect();
        const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
        const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);
        this.paintAt(worldX, worldY);
      }
    });
    window.addEventListener('mouseup', () => {
      this.isPainting = false;
    });

    // Mouse wheel / trackpad zoom
    this.renderer.app.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      // ctrlKey is true for trackpad pinch-to-zoom gestures
      const isPinch = e.ctrlKey;
      this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, e.deltaY, isPinch);
    }, { passive: false });

    // Middle/right-click drag to pan
    let panning = false;
    let lastPanX = 0, lastPanY = 0;
    this.renderer.app.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) {
        panning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        e.preventDefault();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (panning) {
        this.camera.panBy(e.clientX - lastPanX, e.clientY - lastPanY);
        lastPanX = e.clientX;
        lastPanY = e.clientY;
      }
    });
    window.addEventListener('mouseup', () => { panning = false; });
    this.renderer.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Double-click to zoom in
    this.renderer.app.canvas.addEventListener('dblclick', (e) => {
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
      const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);
      this.camera.centerOn(worldX, worldY, 2);
    });

    // Camera keyboard shortcuts + audio init on first interaction
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (!this.audio.isEnabled) this.audio.init();
      if (e.code === 'Digit0') {
        this.camera.resetView();
      } else if (e.code === 'KeyC') {
        this.camera.follow(this.inspector.pinnedIds[0] || null);
      } else if (e.code === 'KeyP') {
        this.setToolMode('paint');
      } else if (e.code === 'KeyB') {
        this.setToolMode('spawn');
      } else if (e.code === 'Escape' && this.toolMode !== 'none') {
        this.setToolMode('none');
      }
    });

    // Hover tooltip
    this.renderer.app.canvas.addEventListener('mousemove', (e) => {
      // Skip tooltip in tool modes
      if (this.toolMode !== 'none') {
        this.tooltip.hide();
        this.renderer.app.canvas.style.cursor = this.toolMode === 'paint' ? 'none' : 'crosshair';
        return;
      }

      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
      const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);

      let bestDist = 20 * 20;
      let best: any = null;
      const check = (c: any) => {
        const dx = c.pos.x - worldX, dy = c.pos.y - worldY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { bestDist = d2; best = c; }
      };
      for (const c of this.sim.renderState.herbivores) check(c);
      for (const c of this.sim.renderState.predators) check(c);
      for (const c of this.sim.renderState.scavengers) check(c);
      for (const c of this.sim.renderState.insects) check(c);

      if (best) {
        const label = best.type.charAt(0).toUpperCase() + best.type.slice(1);
        this.tooltip.show(e.clientX, e.clientY,
          `<span class="tt-type">${label} #${best.id}</span><br>` +
          `Energy: ${best.energy.toFixed(0)} | Gen ${best.generation}<br>` +
          `<span class="tt-behavior">${best.behavior || 'idle'}</span>`
        );
        this.renderer.app.canvas.style.cursor = 'pointer';
      } else {
        this.tooltip.hide();
        this.renderer.app.canvas.style.cursor = 'default';
      }
    });

    this.renderer.app.canvas.addEventListener('mouseleave', () => {
      this.tooltip.hide();
    });

    // Resize handling
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.resize(w, h);
      this.graph.resize();
      this.camera.resize(w, h);
      clampAllPanels();
    });

    // Start loop
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);

    const elapsed = Math.min((now - this.lastTime) / 1000, 0.1); // Cap at 100ms
    this.lastTime = now;

    // FPS counter + performance-based population caps (update every 500ms)
    this.fpsFrames++;
    if (now - this.fpsLastTime >= 500) {
      this.fps = Math.round(this.fpsFrames / ((now - this.fpsLastTime) / 1000));
      this.fpsFrames = 0;
      this.fpsLastTime = now;

      // Performance scaling: 60+ FPS = grow freely, 30 FPS = minimum caps
      const targetFactor = this.fps >= 60 ? 1.0
        : this.fps <= 30 ? 0.0
        : (this.fps - 30) / 30;
      // Smooth the factor (drop fast, recover slow)
      if (targetFactor < this.perfFactor) {
        this.perfFactor += (targetFactor - this.perfFactor) * 0.5; // drop quickly
      } else {
        this.perfFactor += (targetFactor - this.perfFactor) * 0.1; // recover slowly
      }

      // Scale caps: minimum viable populations → full caps
      const f = this.perfFactor;
      const maxH = Math.round(200 + f * 4800);   // 200 – 5000
      const maxP = Math.round(80 + f * 1920);     // 80 – 2000
      const maxS = Math.round(60 + f * 1440);     // 60 – 1500
      const maxI = Math.round(100 + f * 2900);    // 100 – 3000
      this.sim.setPopCaps(maxH, maxP, maxS, maxI);
    }

    if (!this.paused) {
      this.accumulator += elapsed * this.speed * 0.5;

      // Fixed timestep sim updates
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < 8) {
        this.sim.step(SIM_DT);
        this.accumulator -= SIM_DT;
        steps++;
      }
      // Prevent spiral of death
      if (this.accumulator > SIM_DT * 4) {
        this.accumulator = 0;
      }
    }

    // Update camera (smooth interpolation)
    this.camera.update();

    // Follow creature if tracking one
    if (this.camera.state.following !== null) {
      const all = [...this.sim.renderState.herbivores, ...this.sim.renderState.predators, ...this.sim.renderState.scavengers, ...this.sim.renderState.insects];
      const target = all.find(c => c.id === this.camera.state.following);
      if (target) {
        this.camera.centerOn(target.pos.x, target.pos.y);
      } else {
        this.camera.follow(null);
        this.camera.resetView();
      }
    }

    // Render every frame
    this.renderer.render(this.sim.renderState as any, this.sim.renderState.time, this.inspector.pinnedIds, this.camera.state);
    this.ui.updateStats(this.sim.renderState.stats, this.sim.renderState.time, this.fps);
    this.graph.update(this.sim.renderState.stats, this.sim.renderState.time);
    this.inspector.autoPin(this.sim.renderState as any);
    this.inspector.update(this.sim.renderState as any, this.sim.renderState.time);
    this.feed.update(this.sim.renderState.feedEvents, this.sim.renderState.time);
    this.foodChain.update(this.sim.renderState.stats);
    this.minimap.update(this.sim.renderState as any, this.camera.state);

    // Genealogy: only show when enabled AND creature is pinned
    if (this.genealogyEnabled && this.inspector.pinnedIds.length > 0 && !this.genealogy.isVisible()) {
      this.genealogy.show(this.inspector.pinnedIds[0]);
    } else if ((!this.genealogyEnabled || this.inspector.pinnedIds.length === 0) && this.genealogy.isVisible()) {
      this.genealogy.hide();
    }
    if (this.genealogyEnabled) {
      this.genealogy.update(this.sim.renderState.genealogy, this.inspector.pinnedIds);
    }

    // Audio: update ambient drone and rain
    this.audio.updateAmbient(this.sim.renderState.season, this.sim.renderState.dayPhase);
    const rainIntensity = this.sim.renderState.weather.type === 'rain' ? this.sim.renderState.weather.intensity : 0;
    this.audio.updateRain(rainIntensity);

    // Audio: play event stings for new feed events
    const feedEvents = this.sim.renderState.feedEvents;
    for (let i = this.lastFeedCount; i < feedEvents.length; i++) {
      const text = feedEvents[i].text;
      if (text.includes('extinct')) {
        this.audio.playEvent('extinction');
      } else if (text.includes('Disease') || text.includes('disease')) {
        this.audio.playEvent('disease');
      } else if (text.includes('reintroduced') || text.includes('reached')) {
        this.audio.playEvent('birth');
      }
    }
    this.lastFeedCount = feedEvents.length;
  };

  private reset(seed: number): void {
    this.seed = seed;
    this.sim.reset(seed);
    this.accumulator = 0;
    this.ui.updateSeed(seed);
    this.graph.reset();
    this.inspector.clearAll();
    this.feed.reset();
    this.lastFeedCount = 0;
    this.camera.resetView();
    this.renderer.setTrails(this.trails); // Clear trails on reset
    this.updateURL();
  }

  private updateURL(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(this.seed));
    window.history.replaceState({}, '', url.toString());
  }

  private async saveToSlot(slot: number): Promise<void> {
    const wasPaused = this.paused;
    this.paused = true;
    try {
      const data = await this.sim.requestSave();
      const json = JSON.stringify(data);
      localStorage.setItem(`sim-save-slot-${slot}`, json);
    } catch (e) {
      console.error('Save failed:', e);
    }
    if (!wasPaused) this.paused = false;
  }

  private loadFromSlot(slot: number): void {
    const json = localStorage.getItem(`sim-save-slot-${slot}`);
    if (!json) {
      console.warn(`No save data in slot ${slot}`);
      return;
    }
    try {
      const data = JSON.parse(json);
      this.importJSON(data);
    } catch (e) {
      console.error('Load failed:', e);
    }
  }

  private async exportJSON(): Promise<void> {
    const wasPaused = this.paused;
    this.paused = true;
    try {
      const data = await this.sim.requestSave();
      const json = JSON.stringify(data);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ecosystem-save-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
    if (!wasPaused) this.paused = false;
  }

  private importJSON(data: object): void {
    this.paused = true;
    this.ui.updatePaused(true);
    this.sim.loadState(data);
    this.accumulator = 0;
    this.graph.reset();
    this.inspector.clearAll();
    this.feed.reset();
    this.lastFeedCount = 0;
    // Update seed from loaded config if available
    const loaded = data as Record<string, any>;
    if (loaded.config?.seed !== undefined) {
      this.seed = loaded.config.seed;
      this.ui.updateSeed(this.seed);
      this.updateURL();
    }
    // Resume after a short delay to allow state to apply
    setTimeout(() => {
      this.paused = false;
      this.ui.updatePaused(false);
    }, 100);
  }

  private handleConfigChange(key: string, value: number | boolean): void {
    if (key === 'graph') {
      this.graph.toggle();
      return;
    }

    if (key === 'traits') {
      this.graph.toggleTraits();
      return;
    }

    if (key === 'trails') {
      this.trails = !this.trails;
      this.renderer.setTrails(this.trails);
      return;
    }

    if (key === 'trailFade') {
      this.renderer.setTrailFade(value as number);
      return;
    }

    if (key === 'daynight') {
      this.dayNightEnabled = !this.dayNightEnabled;
      this.renderer.setDayNight(this.dayNightEnabled);
      return;
    }

    if (key === 'weather') {
      this.renderer.setWeather(value as boolean);
      return;
    }

    if (key === 'territories') {
      this.renderer.setTerritories(value as boolean);
      return;
    }

    if (key === 'wrapWorld') {
      this.sim.setConfig('wrapWorld', value as boolean);
      return;
    }

    if (key === 'worldSize') {
      const sizes: Record<string, [number, number]> = {
        small: [2000, 2000],
        medium: [4000, 4000],
        large: [6000, 6000],
      };
      const [w, h] = sizes[value as unknown as string] || sizes.medium;
      this.sim.setWorldSize(w, h);
      this.camera.setWorldSize(w, h);
      this.camera.resetView();
      return;
    }

    if (key === 'sound') {
      if (!this.audio.isEnabled) this.audio.init();
      else this.audio.toggle();
      return;
    }

    if (key === 'feed') {
      this.feed.toggle();
      return;
    }

    if (key === 'foodweb') {
      this.foodChain.toggle();
      this.ui.syncToggle('foodweb', this.foodChain.isVisible());
      return;
    }

    if (key === 'genealogy') {
      this.genealogyEnabled = value as boolean;
      if (!this.genealogyEnabled) this.genealogy.hide();
      return;
    }

    if (key === 'inspector') {
      this.inspector.clearAll();
      return;
    }

    this.sim.setConfig(key, value);
  }

  // --- Tool Modes ---

  private setToolMode(mode: ToolMode): void {
    // If same mode, toggle off
    if (this.toolMode === mode) {
      mode = 'none';
    }
    this.toolMode = mode;
    this.isPainting = false;
    this.stampType = null;
    this.ui.updateToolMode(mode);

    // Remove existing toolbar
    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
    // Remove cursor indicator
    if (this.cursorIndicator) {
      this.cursorIndicator.remove();
      this.cursorIndicator = null;
    }

    if (mode === 'paint') {
      this.buildPaintToolbar();
      this.buildCursorIndicator();
    } else if (mode === 'spawn') {
      this.buildSpawnToolbar();
    }
  }

  private buildPaintToolbar(): void {
    const bar = document.createElement('div');
    bar.id = 'tool-toolbar';
    bar.className = 'tool-toolbar';
    bar.innerHTML = `
      <div class="tool-toolbar-title">Paint Terrain <span class="tool-close">&times;</span></div>
      <div class="tool-toolbar-row">
        <button class="tool-btn ${this.paintBrush === 1 ? 'active' : ''}" data-brush="1">Water</button>
        <button class="tool-btn ${this.paintBrush === 2 ? 'active' : ''}" data-brush="2">Fertile</button>
        <button class="tool-btn ${this.paintBrush === 3 ? 'active' : ''}" data-brush="3">Mountain</button>
        <button class="tool-btn ${this.paintBrush === 0 ? 'active' : ''}" data-brush="0">Erase</button>
      </div>
      <div class="tool-toolbar-row">
        <label class="tool-label">Brush</label>
        <button class="tool-btn tool-size ${this.paintRadius === 1 ? 'active' : ''}" data-size="1">S</button>
        <button class="tool-btn tool-size ${this.paintRadius === 3 ? 'active' : ''}" data-size="3">M</button>
        <button class="tool-btn tool-size ${this.paintRadius === 5 ? 'active' : ''}" data-size="5">L</button>
      </div>
      <div class="tool-toolbar-row">
        <label class="tool-label">Stamp</label>
        <button class="tool-btn tool-stamp" data-stamp="lake">Lake</button>
        <button class="tool-btn tool-stamp" data-stamp="river">River</button>
        <button class="tool-btn tool-stamp" data-stamp="mountainRange">Mtn Range</button>
      </div>
    `;
    document.body.appendChild(bar);
    this.toolbarEl = bar;

    // Close button
    bar.querySelector('.tool-close')!.addEventListener('click', () => this.setToolMode('none'));

    // Brush type buttons
    bar.querySelectorAll('[data-brush]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.paintBrush = parseInt((btn as HTMLElement).dataset.brush!) as TerrainBrush;
        this.stampType = null;
        bar.querySelectorAll('[data-brush]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        bar.querySelectorAll('.tool-stamp').forEach(b => b.classList.remove('active'));
      });
    });

    // Size buttons
    bar.querySelectorAll('[data-size]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.paintRadius = parseInt((btn as HTMLElement).dataset.size!);
        this.stampType = null;
        bar.querySelectorAll('.tool-size').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        bar.querySelectorAll('.tool-stamp').forEach(b => b.classList.remove('active'));
        this.updateCursorSize();
      });
    });

    // Stamp buttons
    bar.querySelectorAll('.tool-stamp').forEach(btn => {
      btn.addEventListener('click', () => {
        this.stampType = (btn as HTMLElement).dataset.stamp as StampType;
        bar.querySelectorAll('.tool-stamp').forEach(b => b.classList.remove('active'));
        bar.querySelectorAll('[data-brush]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  private buildSpawnToolbar(): void {
    const bar = document.createElement('div');
    bar.id = 'tool-toolbar';
    bar.className = 'tool-toolbar';
    bar.innerHTML = `
      <div class="tool-toolbar-title">Spawn Creatures <span class="tool-close">&times;</span></div>
      <div class="tool-toolbar-row">
        <button class="tool-btn spawn-btn ${this.spawnType === 'herbivore' ? 'active' : ''}" data-spawn="herbivore">Herb</button>
        <button class="tool-btn spawn-btn ${this.spawnType === 'predator' ? 'active' : ''}" data-spawn="predator">Pred</button>
        <button class="tool-btn spawn-btn ${this.spawnType === 'scavenger' ? 'active' : ''}" data-spawn="scavenger">Scav</button>
        <button class="tool-btn spawn-btn ${this.spawnType === 'insect' ? 'active' : ''}" data-spawn="insect">Insect</button>
      </div>
      <div class="tool-toolbar-hint">Click = 1 | Shift+Click = 5</div>
    `;
    document.body.appendChild(bar);
    this.toolbarEl = bar;

    bar.querySelector('.tool-close')!.addEventListener('click', () => this.setToolMode('none'));

    bar.querySelectorAll('.spawn-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.spawnType = (btn as HTMLElement).dataset.spawn as SpawnType;
        bar.querySelectorAll('.spawn-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  private buildCursorIndicator(): void {
    const el = document.createElement('div');
    el.id = 'paint-cursor';
    el.className = 'paint-cursor';
    document.body.appendChild(el);
    this.cursorIndicator = el;
    this.updateCursorSize();
  }

  private updateCursorSize(): void {
    if (!this.cursorIndicator) return;
    // Calculate pixel size based on brush radius and zoom
    const config = this.sim.renderState.config;
    const cellW = config.worldWidth / config.plantGridCols;
    const pixelR = this.paintRadius * cellW * this.camera.state.zoom;
    const size = pixelR * 2;
    this.cursorIndicator.style.width = `${size}px`;
    this.cursorIndicator.style.height = `${size}px`;
  }

  private handleToolClick(worldX: number, worldY: number, shiftKey: boolean): boolean {
    if (this.toolMode === 'paint') {
      if (this.stampType) {
        this.applyStamp(worldX, worldY);
      } else {
        this.paintAt(worldX, worldY);
      }
      return true;
    }
    if (this.toolMode === 'spawn') {
      const count = shiftKey ? 5 : 1;
      this.sim.spawnCreature(this.spawnType, worldX, worldY, count);
      return true;
    }
    return false;
  }

  private paintAt(worldX: number, worldY: number): void {
    const config = this.sim.renderState.config;
    const cellW = config.worldWidth / config.plantGridCols;
    const cellH = config.worldHeight / config.plantGridRows;
    const col = Math.floor(worldX / cellW);
    const row = Math.floor(worldY / cellH);

    const cells: { col: number; row: number; terrain: number }[] = [];
    const r = this.paintRadius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          cells.push({ col: col + dx, row: row + dy, terrain: this.paintBrush });
        }
      }
    }
    if (cells.length > 0) {
      this.sim.paintTerrain(cells);
    }
  }

  private applyStamp(worldX: number, worldY: number): void {
    const config = this.sim.renderState.config;
    const cellW = config.worldWidth / config.plantGridCols;
    const cellH = config.worldHeight / config.plantGridRows;
    const col = Math.floor(worldX / cellW);
    const row = Math.floor(worldY / cellH);
    const cells: { col: number; row: number; terrain: number }[] = [];

    if (this.stampType === 'lake') {
      // Oval lake ~12x10 cells
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          if ((dx * dx) / 36 + (dy * dy) / 25 <= 1) {
            cells.push({ col: col + dx, row: row + dy, terrain: 1 }); // water
          }
        }
      }
      // Fertile border
      for (let dy = -7; dy <= 7; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          if ((dx * dx) / 64 + (dy * dy) / 49 <= 1 && (dx * dx) / 36 + (dy * dy) / 25 > 1) {
            cells.push({ col: col + dx, row: row + dy, terrain: 2 }); // fertile
          }
        }
      }
    } else if (this.stampType === 'river') {
      // Winding river ~40 cells long, 2-3 wide
      let cx = col - 20;
      let cy = row;
      for (let i = 0; i < 40; i++) {
        const wobble = Math.round(Math.sin(i * 0.3) * 2);
        for (let w = -1; w <= 1; w++) {
          cells.push({ col: cx + i, row: cy + wobble + w, terrain: 1 });
        }
        // Fertile banks
        cells.push({ col: cx + i, row: cy + wobble - 2, terrain: 2 });
        cells.push({ col: cx + i, row: cy + wobble + 2, terrain: 2 });
      }
    } else if (this.stampType === 'mountainRange') {
      // Mountain ridge ~30 cells long, 3-5 wide
      let cx = col - 15;
      let cy = row;
      for (let i = 0; i < 30; i++) {
        const wobble = Math.round(Math.sin(i * 0.2) * 1.5);
        const width = 2 + Math.round(Math.sin(i * 0.4) * 1);
        for (let w = -width; w <= width; w++) {
          cells.push({ col: cx + i, row: cy + wobble + w, terrain: 3 }); // mountain
        }
      }
    }

    if (cells.length > 0) {
      this.sim.paintTerrain(cells);
    }
  }
}

// Auto-start on load
const app = new App();
app.start().catch(console.error);
