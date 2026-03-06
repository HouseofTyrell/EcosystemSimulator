// src/sim/sim-worker-client.ts
import type { SimConfig, SimStats, FeedEvent, Corpse, WeatherState, ActiveEvent } from './types';
import type { RenderSnapshot, CreatureSnapshot, WorkerToMainMessage } from './worker-protocol';

export interface CreatureView {
  id: number;
  type: 'herbivore' | 'predator' | 'scavenger' | 'insect';
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  energy: number;
  age: number;
  maxAge: number;
  generation: number;
  lineageId: number;
  subspecies: number;
  behavior: string;
  alive: boolean;
  infected: number;
  birthPos: { x: number; y: number };
  offspringCount: number;
  deathCause: 'starved' | 'killed' | 'old_age' | 'disease' | null;
  traits: {
    size: number;
    speed: number;
    visionRange: number;
    turnRate: number;
    metabolism: number;
    attackCooldown?: number;
  };
  attackTimer?: number;
}

export interface RenderState {
  config: SimConfig;
  time: number;
  season: number;
  seasonalMultiplier: number;
  dayPhase: number;
  timeOfDay: 'Dawn' | 'Day' | 'Dusk' | 'Night';
  herbivores: CreatureView[];
  predators: CreatureView[];
  scavengers: CreatureView[];
  insects: CreatureView[];
  corpses: Corpse[];
  stats: SimStats;
  feedEvents: FeedEvent[];
  weather: WeatherState;
  activeEvent: ActiveEvent | null;
  plantGrid: Float32Array;
  terrain: Uint8Array;
  lineageCounts: Map<number, number>;
  recentDeaths: Map<number, string>;
  nextId: number;
}

function snapshotToView(s: CreatureSnapshot): CreatureView {
  return {
    id: s.id,
    type: s.type,
    pos: { x: s.x, y: s.y },
    vel: { x: s.vx, y: s.vy },
    energy: s.energy,
    age: s.age,
    maxAge: s.maxAge,
    generation: s.generation,
    lineageId: s.lineageId,
    subspecies: s.subspecies,
    behavior: s.behavior,
    alive: s.alive,
    infected: s.infected,
    birthPos: { x: s.birthPosX, y: s.birthPosY },
    offspringCount: s.offspringCount,
    deathCause: s.deathCause,
    traits: {
      size: s.size,
      speed: s.speed,
      visionRange: s.visionRange,
      turnRate: 0,
      metabolism: 0,
      attackCooldown: s.attackCooldown,
    },
    attackTimer: s.attackTimer,
  };
}

export class SimWorkerClient {
  private worker: Worker;
  private _renderState: RenderState;
  private _ready: boolean = false;
  private _onReady: (() => void) | null = null;

  constructor(config: Partial<SimConfig>) {
    this.worker = new Worker(
      new URL('./sim-worker.ts', import.meta.url),
      { type: 'module' }
    );

    this._renderState = this.createEmptyRenderState(config);

    this.worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        this._renderState.config = msg.config;
        this._ready = true;
        if (this._onReady) this._onReady();
      } else if (msg.type === 'snapshot') {
        this.applySnapshot(msg.data);
      }
    };

    this.worker.postMessage({ type: 'init', config });
  }

  private createEmptyRenderState(config: Partial<SimConfig>): RenderState {
    return {
      config: config as SimConfig,
      time: 0,
      season: 0,
      seasonalMultiplier: 1,
      dayPhase: 0,
      timeOfDay: 'Dawn',
      herbivores: [],
      predators: [],
      scavengers: [],
      insects: [],
      corpses: [],
      stats: {
        herbivoreCount: 0,
        predatorCount: 0,
        plantDensity: 0,
        avgHerbivoreSpeed: 0,
        avgHerbivoreSize: 0,
        avgHerbivoreVision: 0,
        avgPredatorSpeed: 0,
        avgPredatorSize: 0,
        avgPredatorVision: 0,
        scavengerCount: 0,
        avgScavengerSpeed: 0,
        avgScavengerSize: 0,
        seasonName: 'Spring',
        activeEventName: '',
        timeOfDay: 'Dawn',
        weatherName: 'Clear',
        maxGeneration: 0,
        grazerCount: 0,
        foragerCount: 0,
        stalkerCount: 0,
        packHunterCount: 0,
        vultureCount: 0,
        beetleCount: 0,
        insectCount: 0,
        antCount: 0,
        beeCount: 0,
      },
      feedEvents: [],
      weather: { type: 'clear', intensity: 0, duration: 0, remaining: 0, windAngle: 0 },
      activeEvent: null,
      plantGrid: new Float32Array(0),
      terrain: new Uint8Array(0),
      lineageCounts: new Map(),
      recentDeaths: new Map(),
      nextId: 0,
    };
  }

  get renderState(): RenderState {
    return this._renderState;
  }

  get ready(): boolean {
    return this._ready;
  }

  waitForReady(): Promise<void> {
    if (this._ready) return Promise.resolve();
    return new Promise((resolve) => {
      this._onReady = resolve;
    });
  }

  step(dt: number): void {
    this.worker.postMessage({ type: 'step', dt });
  }

  reset(seed?: number): void {
    this.worker.postMessage({ type: 'reset', seed });
  }

  setConfig(key: string, value: number | boolean): void {
    this.worker.postMessage({ type: 'setConfig', key, value });
  }

  setWorldSize(width: number, height: number): void {
    this.worker.postMessage({ type: 'setWorldSize', width, height });
    this._renderState.config.worldWidth = width;
    this._renderState.config.worldHeight = height;
  }

  setPopCaps(maxH: number, maxP: number, maxS: number, maxI: number = 3000): void {
    this.worker.postMessage({
      type: 'setPopCaps',
      maxHerbivores: maxH,
      maxPredators: maxP,
      maxScavengers: maxS,
      maxInsects: maxI,
    });
  }

  private applySnapshot(snap: RenderSnapshot): void {
    const rs = this._renderState;
    rs.config = snap.config;
    rs.time = snap.time;
    rs.season = snap.season;
    rs.seasonalMultiplier = snap.seasonalMultiplier;
    rs.dayPhase = snap.dayPhase;
    rs.timeOfDay = snap.timeOfDay;
    rs.corpses = snap.corpses;
    rs.stats = snap.stats;
    rs.weather = snap.weather;
    rs.activeEvent = snap.activeEvent;
    rs.feedEvents = snap.feedEvents;
    rs.plantGrid = Float32Array.from(snap.plantGrid);
    rs.terrain = Uint8Array.from(snap.terrain);
    rs.lineageCounts = new Map(snap.lineageCounts);
    rs.recentDeaths = new Map(snap.recentDeaths);

    const herbs: CreatureView[] = [];
    const preds: CreatureView[] = [];
    const scavs: CreatureView[] = [];
    const insects: CreatureView[] = [];
    for (let i = 0; i < snap.creatures.length; i++) {
      const c = snap.creatures[i];
      const view = snapshotToView(c);
      if (c.type === 'herbivore') herbs.push(view);
      else if (c.type === 'predator') preds.push(view);
      else if (c.type === 'insect') insects.push(view);
      else scavs.push(view);
    }
    rs.herbivores = herbs;
    rs.predators = preds;
    rs.scavengers = scavs;
    rs.insects = insects;
  }

  destroy(): void {
    this.worker.terminate();
  }
}
