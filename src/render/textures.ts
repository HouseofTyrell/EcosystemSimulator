import { Graphics, Texture, Application } from 'pixi.js';

export interface GeneratedTextures {
  herbivore: Texture;
  predator: Texture;
  scavenger: Texture;
  plant: Texture;
  particle: Texture;
  shadow: Texture;
}

export function generateTextures(app: Application): GeneratedTextures {
  // Herbivore: stocky oval body (deer/buffalo from above) — pointing right
  const herbG = new Graphics();
  herbG.ellipse(0, 0, 7, 4.5);           // main body
  herbG.fill({ color: 0xffffff });
  herbG.ellipse(5.5, 0, 3, 2.5);         // head (smaller oval)
  herbG.fill({ color: 0xffffff });
  const herbivore = app.renderer.generateTexture({
    target: herbG,
    resolution: 2,
  });

  // Predator: sleek elongated body (wolf/cat from above) — pointing right
  const predG = new Graphics();
  predG.ellipse(0, 0, 8, 3.5);           // long lean body
  predG.fill({ color: 0xffffff });
  predG.ellipse(7, 0, 3.5, 2);           // pointed head
  predG.fill({ color: 0xffffff });
  predG.moveTo(-7, -2);                  // tail
  predG.lineTo(-11, -1);
  predG.lineTo(-7, 0);
  predG.closePath();
  predG.fill({ color: 0xffffff });
  const predator = app.renderer.generateTexture({
    target: predG,
    resolution: 2,
  });

  // Scavenger: compact rounded body (small fox/bird from above)
  const scavG = new Graphics();
  scavG.ellipse(0, 0, 5, 3.5);           // round compact body
  scavG.fill({ color: 0xffffff });
  scavG.ellipse(4, 0, 2.5, 2);           // small head
  scavG.fill({ color: 0xffffff });
  const scavenger = app.renderer.generateTexture({ target: scavG, resolution: 2 });

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

  // Shadow: soft dark oval for ground shadow beneath creatures
  const shadowG = new Graphics();
  const shadowSteps = 5;
  const shadowRx = 8;
  const shadowRy = 4;
  for (let i = shadowSteps; i >= 0; i--) {
    const t = i / shadowSteps;
    const a = (1 - t) * (1 - t) * 0.5;
    shadowG.ellipse(0, 0, shadowRx * t, shadowRy * t);
    shadowG.fill({ color: 0x000000, alpha: a });
  }
  const shadow = app.renderer.generateTexture({ target: shadowG, resolution: 2 });
  shadowG.destroy();

  // Cleanup temp graphics
  herbG.destroy();
  predG.destroy();
  scavG.destroy();
  plantG.destroy();
  partG.destroy();

  return { herbivore, predator, scavenger, plant, particle, shadow };
}
