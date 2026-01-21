/**
 * Konomi System - Main Orchestrator
 * Coordinates BlockArrays, Cubes, eVGPU, and Storage
 */

import { eVGPU, evgpu } from './evgpu.js';
import { FemtoLLM } from './femtollm.js';
import { BlockArray } from './blockarray.js';
import { Cube } from './cube.js';
import { storage } from './storage.js';

export class KonomiSystem {
  constructor() {
    this.evgpu = evgpu;
    this.blockArrays = new Map();
    this.cubes = new Map();
    this.storage = storage;
    this.initialized = false;

    // Event system
    this.listeners = new Map();

    // Performance tracking
    this.metrics = {
      operations: 0,
      totalTime: 0,
      startTime: Date.now()
    };
  }

  // Initialize the system
  async init() {
    await this.storage.init();
    this.initialized = true;
    this.emit('init', { timestamp: Date.now() });
    return this;
  }

  // Event system
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return this;
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const cbs = this.listeners.get(event);
      const idx = cbs.indexOf(callback);
      if (idx > -1) cbs.splice(idx, 1);
    }
    return this;
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try { cb(data); } catch (e) { console.error('Event error:', e); }
      }
    }
  }

  // Create a new BlockArray
  createBlockArray(id, dimensions = [10, 10, 10]) {
    const ba = new BlockArray(id, dimensions);
    this.blockArrays.set(id, ba);
    this.emit('blockarray:create', { id, dimensions });
    return ba;
  }

  // Get BlockArray
  getBlockArray(id) {
    return this.blockArrays.get(id);
  }

  // Create a new Cube
  createCube(id) {
    const cube = new Cube(id);
    this.cubes.set(id, cube);
    this.emit('cube:create', { id });
    return cube;
  }

  // Get Cube
  getCube(id) {
    return this.cubes.get(id);
  }

  // Place Cube in BlockArray
  placeCube(cubeId, blockArrayId, x, y, z) {
    const cube = this.cubes.get(cubeId);
    const ba = this.blockArrays.get(blockArrayId);

    if (!cube || !ba) return false;

    // Set position
    cube.position = { blockArrayId, x, y, z };

    // Register in BlockArray
    ba.cubes.set(ba._key(x, y, z), cube);

    // Place LLMs at vertex positions
    for (const v of Cube.VERTICES) {
      const [vx, vy, vz] = Cube.POSITIONS[v];
      ba.setLLM(x + vx, y + vy, z + vz, cube.vertices[v]);
    }

    this.emit('cube:place', { cubeId, blockArrayId, x, y, z });
    return true;
  }

  // Create cube grid within BlockArray
  createCubeGrid(blockArrayId, gridSize, spacing = 2) {
    const ba = this.blockArrays.get(blockArrayId);
    if (!ba) return [];

    const cubes = [];
    let cubeCount = 0;

    for (let x = 0; x < gridSize[0]; x++) {
      for (let y = 0; y < gridSize[1]; y++) {
        for (let z = 0; z < gridSize[2]; z++) {
          const cubeId = `${blockArrayId}-cube-${cubeCount++}`;
          const cube = this.createCube(cubeId);
          this.placeCube(cubeId, blockArrayId, x * spacing, y * spacing, z * spacing);
          cubes.push(cube);
        }
      }
    }

    this.emit('cubegrid:create', { blockArrayId, count: cubes.length });
    return cubes;
  }

  // Process text across distributed cubes
  async distributeProcess(blockArrayId, text) {
    const ba = this.blockArrays.get(blockArrayId);
    if (!ba) return null;

    const start = performance.now();
    const results = [];

    // Get all cubes in the BlockArray
    for (const [key, cube] of ba.cubes) {
      const result = await cube.aggregate(text);
      results.push({
        cubeId: cube.id,
        position: cube.position,
        result
      });
    }

    const elapsed = performance.now() - start;
    this.metrics.operations++;
    this.metrics.totalTime += elapsed;

    this.emit('distribute:complete', { blockArrayId, cubeCount: results.length, elapsed });
    return results;
  }

  // Interlock operation: process across adjacent cubes
  async interlockProcess(blockArrayId, startCoord, text) {
    const ba = this.blockArrays.get(blockArrayId);
    if (!ba) return null;

    const [x, y, z] = startCoord;
    const neighbors = ba.getNeighbors26(x, y, z);

    const results = [];

    // Process at start position
    if (ba.cubes.has(ba._key(x, y, z))) {
      const cube = ba.cubes.get(ba._key(x, y, z));
      results.push({
        coord: [x, y, z],
        result: await cube.processCentral(text)
      });
    }

    // Process at neighbors with cubes
    for (const n of neighbors) {
      const key = ba._key(n.x, n.y, n.z);
      if (ba.cubes.has(key)) {
        const cube = ba.cubes.get(key);
        results.push({
          coord: [n.x, n.y, n.z],
          result: await cube.processCentral(`[INTERLOCK from ${x},${y},${z}] ${text}`)
        });
      }
    }

    this.emit('interlock:complete', { blockArrayId, startCoord, resultCount: results.length });
    return results;
  }

  // Tensor operation using eVGPU
  compute(a, b, op = '@') {
    const start = performance.now();
    const result = this.evgpu.tensor(a, b, op);
    const elapsed = performance.now() - start;

    this.metrics.operations++;
    this.metrics.totalTime += elapsed;

    return result;
  }

  // Save state
  async saveState() {
    const state = {
      id: 'konomi_state',
      blockArrays: [],
      cubes: []
    };

    for (const [id, ba] of this.blockArrays) {
      await this.storage.saveBlockArray(ba);
      state.blockArrays.push(id);
    }

    for (const [id, cube] of this.cubes) {
      await this.storage.saveCube(cube);
      state.cubes.push(id);
    }

    await this.storage.save('config', state);
    this.emit('state:save', state);
    return state;
  }

  // Load state
  async loadState() {
    const state = await this.storage.load('config', 'konomi_state');
    if (!state) return null;

    for (const id of state.blockArrays) {
      const ba = await this.storage.loadBlockArray(id, BlockArray);
      if (ba) this.blockArrays.set(id, ba);
    }

    for (const id of state.cubes) {
      const cube = await this.storage.loadCube(id, Cube);
      if (cube) this.cubes.set(id, cube);
    }

    this.emit('state:load', state);
    return state;
  }

  // Export to static files for GitHub Pages
  exportStaticFiles() {
    const files = [];

    for (const [id, ba] of this.blockArrays) {
      files.push(...this.storage.generateStaticFiles(ba));
    }

    // Master index
    files.push({
      name: 'data/index.json',
      content: JSON.stringify({
        blockArrays: Array.from(this.blockArrays.keys()),
        cubes: Array.from(this.cubes.keys()),
        generated: Date.now()
      })
    });

    return files;
  }

  // Load from GitHub Pages static files
  async loadFromStatic(basePath = 'data/blocks') {
    const index = await this.storage.fetchDataFile('data/index.json');
    if (!index) return null;

    for (const id of index.blockArrays) {
      const ba = await this.storage.loadFromStatic(id, basePath, BlockArray);
      if (ba) this.blockArrays.set(id, ba);
    }

    this.emit('state:loadStatic', index);
    return index;
  }

  // Get system stats
  getStats() {
    return {
      uptime: Date.now() - this.metrics.startTime,
      operations: this.metrics.operations,
      avgOperationTime: this.metrics.operations ?
        this.metrics.totalTime / this.metrics.operations : 0,
      blockArrays: this.blockArrays.size,
      cubes: this.cubes.size,
      evgpu: {
        cores: this.evgpu.cores,
        stats: this.evgpu.stats
      }
    };
  }

  // Reset system
  async reset() {
    this.blockArrays.clear();
    this.cubes.clear();
    await this.storage.clearAll();
    this.metrics = {
      operations: 0,
      totalTime: 0,
      startTime: Date.now()
    };
    this.emit('reset', { timestamp: Date.now() });
  }

  // Demo: Create a sample setup
  async createDemo() {
    // Create a 10x10x10 BlockArray
    const ba = this.createBlockArray('demo', [10, 10, 10]);

    // Create a 3x3x3 cube grid (27 cubes)
    const cubes = this.createCubeGrid('demo', [3, 3, 3], 2);

    // Set some values
    ba.set(0, 0, 0, 1.0);
    ba.set(5, 5, 5, 0.5);

    // Save state
    await this.saveState();

    return { blockArray: ba, cubes };
  }
}

// Create global instance
export const konomi = new KonomiSystem();

// Auto-export for browser
if (typeof window !== 'undefined') {
  window.Konomi = {
    KonomiSystem,
    konomi,
    eVGPU,
    evgpu,
    FemtoLLM,
    BlockArray,
    Cube,
    storage
  };
}
