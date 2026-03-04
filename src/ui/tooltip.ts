export class Tooltip {
  private el: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'tooltip';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  show(x: number, y: number, html: string): void {
    this.el.innerHTML = html;
    this.el.style.display = 'block';
    const pad = 12;
    const maxX = window.innerWidth - 180;
    const maxY = window.innerHeight - 80;
    this.el.style.left = `${Math.min(x + pad, maxX)}px`;
    this.el.style.top = `${Math.min(y + pad, maxY)}px`;
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
