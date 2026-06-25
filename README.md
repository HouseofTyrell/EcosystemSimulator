# Ecosystem Simulator

A real-time ecosystem simulation that runs in the browser. Creatures live on a procedurally generated terrain, search for food, reproduce, and pass on traits, so behaviors like foraging, clustering, and boom-and-bust population cycles emerge on their own instead of being scripted. Built with TypeScript and rendered with PixiJS for smooth 2D WebGL visuals.

> Status: experimental and a work in progress. Fun to watch and tinker with, but behaviors and internals are still changing.

## What it does

- Creatures carry heritable traits that change over generations through reproduction and selection
- Procedural terrain shapes where food appears and how creatures move
- Emergent behavior (foraging, clustering, population swings) arises from simple per-creature rules
- Real-time PixiJS rendering with a pannable, zoomable camera
- A lightweight UI layer for observing and adjusting the simulation, plus audio feedback

## Tech

TypeScript, Vite, and PixiJS. The source is split into focused modules under "src":

- "sim": the simulation engine, including creatures, evolution, terrain, and the update loop
- "render": PixiJS rendering
- "ui": on-screen controls and readouts
- "audio": sound

## Quick start

Requires Node.js 18 or newer.

    git clone https://github.com/HouseofTyrell/EcosystemSimulator.git
    cd EcosystemSimulator
    npm install
    npm run dev

Then open the local URL Vite prints (usually http://localhost:5173).

To build and preview a production bundle:

    npm run build
    npm run preview

## Why I built this

I wanted to see how far simple, local rules could go toward producing lifelike behavior. No global choreography, just creatures reacting to their surroundings, and watching the ecosystem find its own balance or fall out of it.

## License

No license has been set yet, so default copyright applies. If you want to reuse the code, open an issue and I can add one.
