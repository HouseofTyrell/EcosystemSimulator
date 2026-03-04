// Main entry point - wires simulation, renderer, and UI together

import { Simulation } from './sim/simulation';
import { Renderer } from './render/renderer';
import { UIOverlay } from './ui/overlay';
import { PopulationGraph } from './ui/graph';
import { CreatureInspector } from './ui/inspector';
import { EventFeed } from './ui/feed';

const SIM_DT = 1 / 60; // Fixed timestep: 60Hz

class App {
  private sim: Simulation;
  private renderer: Renderer;
  private ui!: UIOverlay;
  private graph!: PopulationGraph;
  private inspector!: CreatureInspector;
  private feed!: EventFeed;
  private paused: boolean = false;
  private speed: number = 1;
  private trails: boolean = false;
  private accumulator: number = 0;
  private lastTime: number = 0;
  private seed: number;

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

    this.inspector = new CreatureInspector(container);

    this.feed = new EventFeed(container);

    this.renderer.app.canvas.addEventListener('click', (e) => {
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const scaleX = this.sim.state.config.worldWidth / rect.width;
      const scaleY = this.sim.state.config.worldHeight / rect.height;
      const worldX = (e.clientX - rect.left) * scaleX;
      const worldY = (e.clientY - rect.top) * scaleY;
      this.inspector.tryPin(this.sim.state, worldX, worldY);
    });

    // Resize handling
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.resize(w, h);
      this.graph.resize();
      this.sim.state.config.worldWidth = w;
      this.sim.state.config.worldHeight = h;
    });

    // Start loop
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);

    const elapsed = Math.min((now - this.lastTime) / 1000, 0.1); // Cap at 100ms
    this.lastTime = now;

    if (!this.paused) {
      this.accumulator += elapsed * this.speed;

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

    // Render every frame
    this.renderer.render(this.sim.state, this.sim.state.time, this.inspector.pinnedIds);
    this.ui.updateStats(this.sim.state.stats, this.sim.state.time);
    this.graph.update(this.sim.state.stats, this.sim.state.time);
    this.inspector.update(this.sim.state, this.sim.state.time);
    this.feed.update(this.sim.state.feedEvents);
  };

  private reset(seed: number): void {
    this.seed = seed;
    this.sim.state.config.worldWidth = window.innerWidth;
    this.sim.state.config.worldHeight = window.innerHeight;
    this.sim.reset(seed);
    this.accumulator = 0;
    this.ui.updateSeed(seed);
    this.graph.reset();
    this.inspector.clearAll();
    this.feed.reset();
    this.renderer.setTrails(this.trails); // Clear trails on reset
  }

  private handleConfigChange(key: string, value: number | boolean): void {
    if (key === 'graph') {
      this.graph.toggle();
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

    if (key === 'wrapWorld') {
      const wrap = value as boolean;
      this.sim.state.config.wrapWorld = wrap;
      this.sim.herbHash.wrap = wrap;
      this.sim.predHash.wrap = wrap;
      this.sim.scavHash.wrap = wrap;
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
