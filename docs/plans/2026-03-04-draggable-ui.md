# Draggable UI Panels

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make overlay UI panels draggable by their headers so users can reposition them to avoid overlap.

**Architecture:** A single reusable `makeDraggable(el, handleEl)` utility adds mousedown/mousemove/mouseup listeners to any panel. Positions are stored as inline `style.left`/`style.top` and persisted to `localStorage` so layouts survive page reloads. No new dependencies.

**Tech Stack:** TypeScript, vanilla DOM events, localStorage

---

## Draggable Panels

These panels become draggable:
1. **Stats** (`#stats`) — drag handle: the panel itself (small, no header)
2. **Settings** (`#settings`) — drag handle: `.settings-header`
3. **Inspector** (`#inspector`) — drag handle: `.inspector-header` on each card (moves entire `#inspector` container)
4. **Event Feed** (`#event-feed`) — drag handle: the panel itself

These stay fixed (no drag):
- Speed indicator, pause indicator, seed display (small, non-overlapping)
- Tooltip, minimap (already positioned contextually)
- Population graph, trait sparklines (bottom-anchored data viz)

---

### Task 1: Create `src/ui/draggable.ts` utility

**Files:**
- Create: `src/ui/draggable.ts`

**Step 1: Write the draggable utility**

```typescript
// src/ui/draggable.ts

const STORAGE_KEY = 'sim-panel-positions';

interface PanelPosition {
  left: number;
  top: number;
}

function loadPositions(): Record<string, PanelPosition> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePositions(positions: Record<string, PanelPosition>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

export function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  const id = panel.id;
  if (!id) return;

  // Restore saved position
  const saved = loadPositions()[id];
  if (saved) {
    panel.style.left = saved.left + 'px';
    panel.style.top = saved.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  handle.style.cursor = 'grab';

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    // Only left-click
    if (e.button !== 0) return;
    dragging = true;
    handle.style.cursor = 'grabbing';

    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // Switch from right/bottom anchoring to left/top
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.marginTop = '0';

    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - offsetX));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offsetY));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';

    // Save position
    const positions = loadPositions();
    positions[id] = {
      left: parseInt(panel.style.left),
      top: parseInt(panel.style.top),
    };
    savePositions(positions);
  });
}

export function resetPanelPositions(): void {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (file is self-contained)

**Step 3: Commit**

```bash
git add src/ui/draggable.ts
git commit -m "feat: add draggable panel utility with localStorage persistence"
```

---

### Task 2: Apply draggable to existing panels

**Files:**
- Modify: `src/ui/overlay.ts` — import and apply to stats, settings
- Modify: `src/ui/inspector.ts` — import and apply to inspector container
- Modify: `src/ui/feed.ts` — import and apply to feed
- Modify: `src/ui/overlay.ts` — add `L` key to reset layout

**Step 1: Wire up draggable in overlay.ts**

In `UIOverlay` constructor, after all elements are appended:

```typescript
import { makeDraggable, resetPanelPositions } from './draggable';

// After elements are appended to overlay:
makeDraggable(this.statsEl, this.statsEl);
makeDraggable(this.settingsEl, this.settingsEl.querySelector('.settings-header')! as HTMLElement);
```

Add to keyboard handler switch block:
```typescript
case 'KeyL':
  resetPanelPositions();
  break;
```

Add to help innerHTML:
```html
<div><span class="key">L</span> Reset panel layout</div>
```

**Step 2: Wire up draggable in inspector.ts**

In `CreatureInspector` constructor, after panelEl is appended:

```typescript
import { makeDraggable } from './draggable';

// In constructor, after appendChild:
makeDraggable(this.panelEl, this.panelEl);
```

**Step 3: Wire up draggable in feed.ts**

In `EventFeed` constructor (or wherever the feed element is created):

```typescript
import { makeDraggable } from './draggable';

// After feed element appended:
makeDraggable(this.el, this.el);
```

**Step 4: Verify and commit**

Run: `npx tsc --noEmit`
Expected: Clean

```bash
git add src/ui/draggable.ts src/ui/overlay.ts src/ui/inspector.ts src/ui/feed.ts
git commit -m "feat: make stats, settings, inspector, and feed panels draggable"
```

---

### Task 3: CSS adjustments for draggable panels

**Files:**
- Modify: `src/styles.css`

**Step 1: Add grab cursor hints and transition removal during drag**

All draggable panels need `position: absolute` (already have it). Remove any `right:` or `bottom:` anchoring that would fight with `left:`/`top:` once dragging starts (handled in JS by setting `right: auto`). Add a subtle visual hint:

```css
/* Draggable panel grab hint */
#stats:hover,
#settings .settings-header:hover,
#inspector:hover,
#event-feed:hover {
  border-color: rgba(68, 102, 136, 0.6);
}
```

**Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style: add hover hint for draggable panels"
```

---

### Task 4: Final verification

**Step 1: Build check**

Run: `npx tsc --noEmit && npx vite build`
Expected: Clean compile and build

**Step 2: Manual test checklist**

- [ ] Stats panel: drag to reposition, reload page, position restored
- [ ] Settings panel: drag by header, settings still expand/collapse
- [ ] Inspector: drag to reposition, clicking creature still pins
- [ ] Event feed: drag to reposition
- [ ] Press `L`: all panels snap back to default positions
- [ ] No interference with camera pan (middle/right-click)
- [ ] No interference with creature click-to-pin (left-click on canvas)
