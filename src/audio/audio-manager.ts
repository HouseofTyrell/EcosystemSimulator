// Web Audio API sound design: ambient drone, rain noise, event stings

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = false;
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private rainNode: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;

  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.gain.value = 0.3;
    this.enabled = true;
    this.startAmbient();
  }

  get isEnabled(): boolean { return this.enabled; }

  setVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = v;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.3 : 0, this.ctx!.currentTime, 0.1);
    }
    return this.enabled;
  }

  private startAmbient(): void {
    if (!this.ctx || !this.masterGain) return;

    // Soft low drone
    this.ambientOsc = this.ctx.createOscillator();
    this.ambientGain = this.ctx.createGain();
    this.ambientOsc.type = 'sine';
    this.ambientOsc.frequency.value = 80;
    this.ambientGain.gain.value = 0.04;
    this.ambientOsc.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    this.ambientOsc.start();
  }

  updateAmbient(season: number, dayPhase: number): void {
    if (!this.ambientOsc || !this.ambientGain || !this.ctx) return;

    // Shift frequency with season (lower in winter, higher in summer)
    const seasonFreq = 70 + Math.sin(season * Math.PI * 2) * 15;
    this.ambientOsc.frequency.setTargetAtTime(seasonFreq, this.ctx.currentTime, 0.5);

    // Quieter at night
    const isNight = dayPhase > 0.75 || dayPhase < 0.05;
    const targetVol = isNight ? 0.02 : 0.04;
    this.ambientGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.3);
  }

  updateRain(intensity: number): void {
    if (!this.ctx || !this.masterGain) return;

    if (intensity > 0 && !this.rainNode) {
      // Create noise buffer for rain
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
      }

      this.rainNode = this.ctx.createBufferSource();
      this.rainNode.buffer = buffer;
      this.rainNode.loop = true;

      // Bandpass filter for rain sound
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 3000;
      filter.Q.value = 0.5;

      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;

      this.rainNode.connect(filter);
      filter.connect(this.rainGain);
      this.rainGain.connect(this.masterGain);
      this.rainNode.start();
    }

    if (this.rainGain && this.ctx) {
      const target = intensity > 0 ? intensity * 0.15 : 0;
      this.rainGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.3);
    }

    if (intensity <= 0 && this.rainNode) {
      try { this.rainNode.stop(); } catch { /* already stopped */ }
      this.rainNode = null;
      this.rainGain = null;
    }
  }

  playEvent(type: 'birth' | 'death' | 'extinction' | 'disease'): void {
    if (!this.ctx || !this.enabled || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.masterGain);

    const now = this.ctx.currentTime;
    if (type === 'birth') {
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'death') {
      osc.frequency.value = 200;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else if (type === 'extinction') {
      osc.frequency.value = 150;
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
      osc.start(now);
      osc.stop(now + 1.0);
    } else if (type === 'disease') {
      osc.frequency.value = 350;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    }
  }

  destroy(): void {
    if (this.ambientOsc) { try { this.ambientOsc.stop(); } catch { /* already stopped */ } }
    if (this.rainNode) { try { this.rainNode.stop(); } catch { /* already stopped */ } }
    if (this.ctx) { this.ctx.close(); }
  }
}
