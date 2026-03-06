// Main entry point - wires simulation, renderer, and UI together

import { Simulation } from './sim/simulation';
import { Renderer } from './render/renderer';
import { UIOverlay } from './ui/overlay';
import { PopulationGraph } from './ui/graph';
import { CreatureInspector } from './ui/inspector';
import { EventFeed } from './ui/feed';
import { Camera } from './camera';
import { Tooltip } from './ui/tooltip';
import { Minimap } from './ui/minimap';
import { AudioManager } from './audio/audio-manager';
import { clampAllPanels, makeDraggable } from './ui/draggable';

const SIM_DT = 1 / 60; // Fixed timestep: 60Hz

class App {
  private sim: Simulation;
  private renderer: Renderer;
  private ui!: UIOverlay;
  private graph!: PopulationGraph;
  private inspector!: CreatureInspector;
  private feed!: EventFeed;
  private camera!: Camera;
  private tooltip!: Tooltip;
  private minimap!: Minimap;
  private audio: AudioManager = new AudioManager();
  private lastFeedCount: number = 0;
  private paused: boolean = false;
  private speed: number = 1;
  private trails: boolean = false;
  private dayNightEnabled: boolean = true;
  private accumulator: number = 0;
  private lastTime: number = 0;
  private seed: number;
  private fpsFrames: number = 0;
  private fpsLastTime: number = 0;
  private fps: number = 0;

  constructor() {
    this.seed = Math.floor(Math.random() * 999999);
    this.sim = new Simulation({ seed: this.seed });
    this.renderer = new Renderer();
  }

  async start(): Promise<void> {
    const container = document.getElementById('app')!;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Update sim world size to match screen
    this.sim.state.config.worldWidth = width;
    this.sim.state.config.worldHeight = height;
    this.sim.reset(this.seed);
    this.updatePopCaps();

    this.camera = new Camera(width, height);

    await this.renderer.init({
      container,
      width,
      height,
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
      isPaused: () => this.paused,
      getSpeed: () => this.speed,
      getSeed: () => this.seed,
    });

    this.ui.updateSpeed(this.speed);
    this.ui.updateSeed(this.seed);

    this.graph = new PopulationGraph(container);
    makeDraggable(this.graph.getPanel(), this.graph.getHeader());

    this.inspector = new CreatureInspector(container);

    this.feed = new EventFeed(container);

    this.tooltip = new Tooltip(document.body);

    this.minimap = new Minimap(document.body);
    this.minimap.onClick((x, y) => this.camera.centerOn(x, y), this.sim.state.config);

    this.renderer.app.canvas.addEventListener('click', (e) => {
      if (!this.audio.isEnabled) this.audio.init();
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const worldX = this.camera.screenToWorldX(e.clientX - rect.left, rect.width);
      const worldY = this.camera.screenToWorldY(e.clientY - rect.top, rect.height);
      this.inspector.tryPin(this.sim.state, worldX, worldY);
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
      }
    });

    // Hover tooltip
    this.renderer.app.canvas.addEventListener('mousemove', (e) => {
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
      for (const c of this.sim.state.herbivores) check(c);
      for (const c of this.sim.state.predators) check(c);
      for (const c of this.sim.state.scavengers) check(c);

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
      this.sim.state.config.worldWidth = w;
      this.sim.state.config.worldHeight = h;
      this.camera.resize(w, h);
      this.updatePopCaps();
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

    // FPS counter (update every 500ms)
    this.fpsFrames++;
    if (now - this.fpsLastTime >= 500) {
      this.fps = Math.round(this.fpsFrames / ((now - this.fpsLastTime) / 1000));
      this.fpsFrames = 0;
      this.fpsLastTime = now;
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
      const all = [...this.sim.state.herbivores, ...this.sim.state.predators, ...this.sim.state.scavengers];
      const target = all.find(c => c.id === this.camera.state.following);
      if (target) {
        this.camera.centerOn(target.pos.x, target.pos.y);
      } else {
        this.camera.follow(null);
        this.camera.resetView();
      }
    }

    // Render every frame
    this.renderer.render(this.sim.state, this.sim.state.time, this.inspector.pinnedIds, this.camera.state);
    this.ui.updateStats(this.sim.state.stats, this.sim.state.time, this.fps);
    this.graph.update(this.sim.state.stats, this.sim.state.time);
    this.inspector.autoPin(this.sim.state);
    this.inspector.update(this.sim.state, this.sim.state.time);
    this.feed.update(this.sim.state.feedEvents, this.sim.state.time);
    this.minimap.update(this.sim.state, this.camera.state);

    // Audio: update ambient drone and rain
    this.audio.updateAmbient(this.sim.state.season, this.sim.state.dayPhase);
    const rainIntensity = this.sim.state.weather.type === 'rain' ? this.sim.state.weather.intensity : 0;
    this.audio.updateRain(rainIntensity);

    // Audio: play event stings for new feed events
    const feedEvents = this.sim.state.feedEvents;
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
    this.sim.state.config.worldWidth = window.innerWidth;
    this.sim.state.config.worldHeight = window.innerHeight;
    this.sim.reset(seed);
    this.updatePopCaps();
    this.accumulator = 0;
    this.ui.updateSeed(seed);
    this.graph.reset();
    this.inspector.clearAll();
    this.feed.reset();
    this.lastFeedCount = 0;
    this.camera.resetView();
    this.renderer.setTrails(this.trails); // Clear trails on reset
  }

  private updatePopCaps(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = (w * h) / (1920 * 1080);
    this.sim.state.config.maxHerbivores = Math.floor(800 * scale);
    this.sim.state.config.maxPredators = Math.floor(250 * scale);
    this.sim.state.config.maxScavengers = Math.floor(150 * scale);
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

    if (key === 'wrapWorld') {
      const wrap = value as boolean;
      this.sim.state.config.wrapWorld = wrap;
      this.sim.herbHash.wrap = wrap;
      this.sim.predHash.wrap = wrap;
      this.sim.scavHash.wrap = wrap;
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

    if (key === 'inspector') {
      this.inspector.clearAll();
      return;
    }

    const config = this.sim.state.config;
    if (key in config) {
      (config as unknown as Record<string, number | boolean>)[key] = value;
    }
  }
}

// Auto-start on load
const app = new App();
app.start().catch(console.error);
