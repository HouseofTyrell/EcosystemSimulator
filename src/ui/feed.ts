import type { FeedEvent } from '../sim/types';

const MAX_ENTRIES = 6;
const FADE_TIME = 30;

interface FeedEntry {
  event: FeedEvent;
  addedAt: number;
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
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  update(feedEvents: FeedEvent[]): void {
    const now = Date.now() / 1000;
    for (let i = this.lastCount; i < feedEvents.length; i++) {
      this.entries.push({ event: feedEvents[i], addedAt: now });
    }
    this.lastCount = feedEvents.length;

    this.entries = this.entries.filter(e => now - e.addedAt < FADE_TIME);

    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    if (!this.visible) return;
    this.render(now);
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

  private render(now: number): void {
    let html = '';
    for (const entry of this.entries) {
      const age = now - entry.addedAt;
      const alpha = Math.max(0.3, 1 - age / FADE_TIME);
      html += `<div class="feed-entry" style="opacity:${alpha}">
        <span class="feed-time">${this.formatTime(entry.event.time)}</span>
        <span style="color:${entry.event.color}">${entry.event.text}</span>
      </div>`;
    }
    this.el.innerHTML = html;
  }
}
