import type { FeedEvent } from '../sim/types';
import { makeDraggable } from './draggable';

const MAX_ENTRIES = 10;
const DEFAULT_DURATION = 8;   // sim-seconds before fade begins
const CRITICAL_DURATION = 15; // sim-seconds for critical events

interface FeedEntry {
  event: FeedEvent;
  addedAtSimTime: number;
  duration: number;
  critical: boolean;
  borderColor: string;
}

export class EventFeed {
  private el: HTMLDivElement;
  private entries: FeedEntry[] = [];
  private visible: boolean = true;
  private lastCount: number = 0;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'event-feed';
    container.appendChild(this.el);
    makeDraggable(this.el, this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  update(feedEvents: FeedEvent[], simTime: number): void {
    for (let i = this.lastCount; i < feedEvents.length; i++) {
      const ev = feedEvents[i];
      const text = ev.text;
      const isCritical = text.includes('EXTINCT') || text.includes('disease') || text.includes('bloom');
      const borderColor = text.includes('EXTINCT') ? '#cc3333' :
                          text.includes('disease') ? '#ccaa33' :
                          text.includes('bloom') ? '#33cc66' : 'transparent';
      const duration = isCritical ? CRITICAL_DURATION : DEFAULT_DURATION;
      this.entries.push({
        event: ev,
        addedAtSimTime: simTime,
        duration,
        critical: isCritical,
        borderColor,
      });
    }
    this.lastCount = feedEvents.length;

    // Remove entries that have fully faded (age > duration)
    this.entries = this.entries.filter(e => simTime - e.addedAtSimTime < e.duration);

    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    if (!this.visible) return;
    this.render(simTime);
  }

  reset(): void {
    this.entries = [];
    this.lastCount = 0;
    this.el.innerHTML = '';
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private render(simTime: number): void {
    let html = '';
    for (const entry of this.entries) {
      const age = simTime - entry.addedAtSimTime;
      const alpha = Math.max(0.4, 1 - age / entry.duration);
      const criticalClass = entry.critical ? ' critical' : '';
      const borderStyle = entry.critical ? ` border-left-color:${entry.borderColor};` : '';
      html += `<div class="feed-entry${criticalClass}" style="opacity:${alpha};${borderStyle}">
        <span class="feed-time">${this.formatTime(entry.event.time)}</span>
        <span style="color:${entry.event.color}">${entry.event.text}</span>
      </div>`;
    }
    this.el.innerHTML = html;
  }
}
