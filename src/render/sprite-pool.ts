import { Sprite, Texture, Container } from 'pixi.js';

export class SpritePool {
  private pool: Sprite[] = [];
  private texture: Texture;
  private container: Container;

  constructor(texture: Texture, container: Container) {
    this.texture = texture;
    this.container = container;
  }

  acquire(): Sprite {
    let sprite: Sprite;
    if (this.pool.length > 0) {
      sprite = this.pool.pop()!;
    } else {
      sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      this.container.addChild(sprite);
    }
    sprite.visible = true;
    sprite.alpha = 1;
    sprite.scale.set(1);
    sprite.rotation = 0;
    return sprite;
  }

  release(sprite: Sprite): void {
    sprite.visible = false;
    this.pool.push(sprite);
  }

  releaseAll(): void {
    for (let i = this.container.children.length - 1; i >= 0; i--) {
      const child = this.container.children[i] as Sprite;
      if (child.visible) {
        child.visible = false;
        this.pool.push(child);
      }
    }
  }
}
