// Draggable panel utility — adds drag-to-reposition with localStorage persistence

const STORAGE_KEY = 'sim-panel-positions';
const trackedPanels: HTMLElement[] = [];

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

function clampToViewport(panel: HTMLElement): void {
  const rect = panel.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Only clamp panels that have been dragged (left is set as px)
  if (!panel.style.left || panel.style.left === 'auto') return;

  let left = rect.left;
  let top = rect.top;
  let changed = false;

  // Ensure at least 40px of the panel is visible
  if (left > vw - 40) { left = vw - 40; changed = true; }
  if (top > vh - 40) { top = vh - 40; changed = true; }
  if (left < -rect.width + 40) { left = 0; changed = true; }
  if (top < 0) { top = 0; changed = true; }

  if (changed) {
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    if (panel.id) {
      const positions = loadPositions();
      positions[panel.id] = { left, top };
      savePositions(positions);
    }
  }
}

export function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  const id = panel.id;
  if (!id) return;

  trackedPanels.push(panel);

  // Restore saved position (with viewport validation)
  const saved = loadPositions()[id];
  if (saved) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(0, Math.min(saved.left, vw - 40));
    const top = Math.max(0, Math.min(saved.top, vh - 40));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.marginTop = '0';
  }

  handle.style.cursor = 'grab';

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    handle.style.cursor = 'grabbing';

    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // Switch from any anchoring to left/top
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

    const positions = loadPositions();
    positions[id] = {
      left: parseInt(panel.style.left),
      top: parseInt(panel.style.top),
    };
    savePositions(positions);
  });
}

/** Re-clamp all tracked panels to current viewport. Call on window resize. */
export function clampAllPanels(): void {
  for (const panel of trackedPanels) {
    clampToViewport(panel);
  }
}

export function resetPanelPositions(): void {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}
