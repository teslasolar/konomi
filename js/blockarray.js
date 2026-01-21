/**
 * BlockArray - Sparse 3D grid for distributed compute
 * Supports 1000^3 (1 billion) cells via sparse storage
 * LLMs can be placed at any coordinate
 */

import { FemtoLLM } from './femtollm.js';

export class BlockArray {
  constructor(id, dimensions = [1000, 1000, 1000]) {
    this.id = id;
    this.dims = dimensions;
    this.data = new Map();      // Sparse storage: "x,y,z" -> value
    this.llms = new Map();      // Coord -> FemtoLLM
    this.cubes = new Map();     // Coord -> Cube reference
    this.metadata = {
      created: Date.now(),
      modified: Date.now(),
      cellCount: 0,
      llmCount: 0
    };
  }

  // Coordinate key
  _key(x, y, z) {
    return `${x},${y},${z}`;
  }

  // Parse key back to coords
  _parseKey(key) {
    return key.split(',').map(Number);
  }

  // Bounds check
  _inBounds(x, y, z) {
    return x >= 0 && x < this.dims[0] &&
           y >= 0 && y < this.dims[1] &&
           z >= 0 && z < this.dims[2];
  }

  // Get value at coordinate
  get(x, y, z) {
    if (!this._inBounds(x, y, z)) return null;
    return this.data.get(this._key(x, y, z)) ?? 0;
  }

  // Set value at coordinate
  set(x, y, z, value) {
    if (!this._inBounds(x, y, z)) return false;

    const key = this._key(x, y, z);
    if (value === 0) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }

    this.metadata.modified = Date.now();
    this.metadata.cellCount = this.data.size;
    return true;
  }

  // Place LLM at coordinate
  setLLM(x, y, z, llm = null) {
    if (!this._inBounds(x, y, z)) return null;

    const key = this._key(x, y, z);
    const instance = llm || new FemtoLLM(`llm-${key}`);
    this.llms.set(key, instance);
    this.metadata.llmCount = this.llms.size;

    return instance;
  }

  // Get or create LLM at coordinate
  getLLM(x, y, z) {
    const key = this._key(x, y, z);
    if (!this.llms.has(key)) {
      return this.setLLM(x, y, z);
    }
    return this.llms.get(key);
  }

  // Remove LLM
  removeLLM(x, y, z) {
    const key = this._key(x, y, z);
    const removed = this.llms.delete(key);
    this.metadata.llmCount = this.llms.size;
    return removed;
  }

  // Process text with LLM at coordinate
  async processAt(x, y, z, text) {
    const llm = this.getLLM(x, y, z);
    return llm.process(text);
  }

  // Batch set values
  setBatch(entries) {
    for (const [x, y, z, v] of entries) {
      this.set(x, y, z, v);
    }
    return entries.length;
  }

  // Get all non-zero cells in region
  getRegion(x1, y1, z1, x2, y2, z2) {
    const result = [];
    for (const [key, value] of this.data) {
      const [x, y, z] = this._parseKey(key);
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2 && z >= z1 && z <= z2) {
        result.push({ x, y, z, value });
      }
    }
    return result;
  }

  // Get neighbors (6-connected)
  getNeighbors(x, y, z) {
    const offsets = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    return offsets
      .map(([dx, dy, dz]) => ({
        x: x + dx, y: y + dy, z: z + dz,
        value: this.get(x + dx, y + dy, z + dz)
      }))
      .filter(n => n.value !== null);
  }

  // Get all 26 neighbors (full connectivity)
  getNeighbors26(x, y, z) {
    const result = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const value = this.get(x + dx, y + dy, z + dz);
          if (value !== null) {
            result.push({ x: x + dx, y: y + dy, z: z + dz, value });
          }
        }
      }
    }
    return result;
  }

  // Face interlock: process across a face of cubes
  async faceInterlock(face, text) {
    const llmCoords = [];

    switch (face) {
      case 'xy':
        for (const [key] of this.llms) {
          const [x, y, z] = this._parseKey(key);
          if (z === 0) llmCoords.push([x, y, z]);
        }
        break;
      case 'xz':
        for (const [key] of this.llms) {
          const [x, y, z] = this._parseKey(key);
          if (y === 0) llmCoords.push([x, y, z]);
        }
        break;
      case 'yz':
        for (const [key] of this.llms) {
          const [x, y, z] = this._parseKey(key);
          if (x === 0) llmCoords.push([x, y, z]);
        }
        break;
    }

    // Process in parallel
    const results = await Promise.all(
      llmCoords.map(([x, y, z]) => this.processAt(x, y, z, text))
    );

    return llmCoords.map(([x, y, z], i) => ({
      coord: { x, y, z },
      result: results[i]
    }));
  }

  // Serialize for storage
  serialize() {
    const dataArray = [];
    for (const [key, value] of this.data) {
      const [x, y, z] = this._parseKey(key);
      dataArray.push([x, y, z, value]);
    }

    const llmArray = [];
    for (const [key, llm] of this.llms) {
      const [x, y, z] = this._parseKey(key);
      llmArray.push({ coord: [x, y, z], llm: llm.serialize() });
    }

    return {
      id: this.id,
      dims: this.dims,
      data: dataArray,
      llms: llmArray,
      metadata: this.metadata
    };
  }

  // Deserialize
  static deserialize(obj) {
    const ba = new BlockArray(obj.id, obj.dims);

    for (const [x, y, z, v] of obj.data) {
      ba.set(x, y, z, v);
    }

    for (const { coord, llm } of obj.llms) {
      ba.setLLM(coord[0], coord[1], coord[2], FemtoLLM.deserialize(llm));
    }

    ba.metadata = obj.metadata;
    return ba;
  }

  // Pack to binary (more efficient storage)
  packBinary() {
    const entries = Array.from(this.data.entries());
    const buffer = new ArrayBuffer(4 + entries.length * 16); // header + entries
    const view = new DataView(buffer);

    view.setUint32(0, entries.length, true);

    let offset = 4;
    for (const [key, value] of entries) {
      const [x, y, z] = this._parseKey(key);
      view.setUint32(offset, x, true);
      view.setUint32(offset + 4, y, true);
      view.setUint32(offset + 8, z, true);
      view.setFloat32(offset + 12, value, true);
      offset += 16;
    }

    return buffer;
  }

  // Unpack from binary
  static unpackBinary(buffer, id, dims) {
    const ba = new BlockArray(id, dims);
    const view = new DataView(buffer);
    const count = view.getUint32(0, true);

    let offset = 4;
    for (let i = 0; i < count; i++) {
      const x = view.getUint32(offset, true);
      const y = view.getUint32(offset + 4, true);
      const z = view.getUint32(offset + 8, true);
      const v = view.getFloat32(offset + 12, true);
      ba.set(x, y, z, v);
      offset += 16;
    }

    return ba;
  }

  // Stats
  getStats() {
    return {
      id: this.id,
      dimensions: this.dims,
      totalCapacity: this.dims[0] * this.dims[1] * this.dims[2],
      activeCells: this.data.size,
      activeLLMs: this.llms.size,
      sparsity: 1 - (this.data.size / (this.dims[0] * this.dims[1] * this.dims[2])),
      ...this.metadata
    };
  }
}
