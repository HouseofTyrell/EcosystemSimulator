// Draggable panel utility — adds drag-to-reposition with localStorage persistence

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

export function resetPanelPositions(): void {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}
