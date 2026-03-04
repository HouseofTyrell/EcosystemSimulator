import { Graphics, Texture, Application } from 'pixi.js';

export interface GeneratedTextures {
  herbivore: Texture;
  predator: Texture;
  plant: Texture;
  particle: Texture;
}

export function generateTextures(app: Application): GeneratedTextures {
  // Herbivore: soft rounded blob
  const herbG = new Graphics();
  herbG.circle(0, 0, 6);
  herbG.fill({ color: 0xffffff });
  const herbivore = app.renderer.generateTexture({
    target: herbG,
    resolution: 2,
  });

  // Predator: angular diamond shape pointing right (nose forward)
  const predG = new Graphics();
  predG.moveTo(7, 0);    // nose (right)
  predG.lineTo(0, -5);   // top-left
  predG.lineTo(-4, 0);   // tail
  predG.lineTo(0, 5);    // bottom-left
  predG.closePath();
  predG.fill({ color: 0xffffff });
  const predator = app.renderer.generateTexture({
    target: predG,
    resolution: 2,
  });

  // Plant: tiny soft dot
  const plantG = new Graphics();
  plantG.circle(0, 0, 3);
  plantG.fill({ color: 0xffffff });
  const plant = app.renderer.generateTexture({
    target: plantG,
    resolution: 2,
  });

  // Particle: tiny dot for death/birth effects
  const partG = new Graphics();
  partG.circle(0, 0, 2);
  partG.fill({ color: 0xffffff });
  const particle = app.renderer.generateTexture({
    target: partG,
    resolution: 2,
  });

  // Cleanup temp graphics
  herbG.destroy();
  predG.destroy();
  plantG.destroy();
  partG.destroy();

  return { herbivore, predator, plant, particle };
}
