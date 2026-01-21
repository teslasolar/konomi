/**
 * Storage - BlockArray DB file management for GitHub Pages
 * Uses IndexedDB for persistence + fetch for loading static data files
 * Packs data efficiently into JSON chunks
 */

export class Storage {
  static DB_NAME = 'konomi_db';
  static DB_VERSION = 1;
  static STORES = ['blockArrays', 'cubes', 'config', 'chunks'];
  static CHUNK_SIZE = 10000; // Entries per chunk

  constructor() {
    this.db = null;
    this.cache = new Map();
  }

  // Initialize IndexedDB
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(Storage.DB_NAME, Storage.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        for (const store of Storage.STORES) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: 'id' });
          }
        }
      };
    });
  }

  // Save to IndexedDB
  async save(store, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const request = os.put(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Load from IndexedDB
  async load(store, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      const request = os.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Delete from IndexedDB
  async delete(store, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const request = os.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // List all in store
  async list(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      const request = os.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Save BlockArray (chunked for efficiency)
  async saveBlockArray(blockArray) {
    const serialized = blockArray.serialize();

    // Split data into chunks
    const chunks = [];
    const data = serialized.data;

    for (let i = 0; i < data.length; i += Storage.CHUNK_SIZE) {
      const chunk = {
        id: `${serialized.id}_chunk_${Math.floor(i / Storage.CHUNK_SIZE)}`,
        parentId: serialized.id,
        data: data.slice(i, i + Storage.CHUNK_SIZE),
        index: Math.floor(i / Storage.CHUNK_SIZE)
      };
      chunks.push(chunk);
      await this.save('chunks', chunk);
    }

    // Save metadata (without data)
    const meta = {
      ...serialized,
      data: null,
      chunkCount: chunks.length,
      chunkIds: chunks.map(c => c.id)
    };

    await this.save('blockArrays', meta);

    // Update cache
    this.cache.set(serialized.id, blockArray);

    return meta;
  }

  // Load BlockArray (with chunks)
  async loadBlockArray(id, BlockArrayClass) {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }

    const meta = await this.load('blockArrays', id);
    if (!meta) return null;

    // Load all chunks
    const allData = [];
    for (const chunkId of meta.chunkIds) {
      const chunk = await this.load('chunks', chunkId);
      if (chunk) {
        allData.push(...chunk.data);
      }
    }

    // Reconstruct
    const fullData = {
      ...meta,
      data: allData
    };

    const blockArray = BlockArrayClass.deserialize(fullData);
    this.cache.set(id, blockArray);

    return blockArray;
  }

  // Save Cube
  async saveCube(cube) {
    const serialized = cube.serialize();
    await this.save('cubes', serialized);
    return serialized;
  }

  // Load Cube
  async loadCube(id, CubeClass) {
    const data = await this.load('cubes', id);
    if (!data) return null;
    return CubeClass.deserialize(data);
  }

  // Fetch static data file from GitHub Pages
  async fetchDataFile(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      console.warn(`Failed to fetch ${path}:`, e);
      return null;
    }
  }

  // Fetch binary data file
  async fetchBinaryFile(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (e) {
      console.warn(`Failed to fetch ${path}:`, e);
      return null;
    }
  }

  // Export to JSON file (for download)
  exportToJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  }

  // Export to binary (more compact)
  exportToBinary(arrayBuffer, filename) {
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  }

  // Import from file input
  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          if (file.name.endsWith('.json')) {
            resolve(JSON.parse(reader.result));
          } else {
            resolve(reader.result); // ArrayBuffer
          }
        } catch (e) {
          reject(e);
        }
      };

      reader.onerror = () => reject(reader.error);

      if (file.name.endsWith('.json')) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  }

  // Generate static data files for GitHub Pages
  generateStaticFiles(blockArray) {
    const serialized = blockArray.serialize();
    const files = [];

    // Split into chunk files
    const data = serialized.data;
    const chunkCount = Math.ceil(data.length / Storage.CHUNK_SIZE);

    for (let i = 0; i < chunkCount; i++) {
      const chunk = data.slice(i * Storage.CHUNK_SIZE, (i + 1) * Storage.CHUNK_SIZE);
      files.push({
        name: `data/blocks/${serialized.id}_${i}.json`,
        content: JSON.stringify(chunk)
      });
    }

    // Index file
    files.push({
      name: `data/blocks/${serialized.id}_index.json`,
      content: JSON.stringify({
        id: serialized.id,
        dims: serialized.dims,
        metadata: serialized.metadata,
        chunkCount,
        llms: serialized.llms
      })
    });

    return files;
  }

  // Load from static GitHub Pages files
  async loadFromStatic(id, basePath = 'data/blocks', BlockArrayClass) {
    // Load index
    const index = await this.fetchDataFile(`${basePath}/${id}_index.json`);
    if (!index) return null;

    // Load all chunks
    const allData = [];
    for (let i = 0; i < index.chunkCount; i++) {
      const chunk = await this.fetchDataFile(`${basePath}/${id}_${i}.json`);
      if (chunk) {
        allData.push(...chunk);
      }
    }

    // Reconstruct
    const fullData = {
      ...index,
      data: allData
    };

    return BlockArrayClass.deserialize(fullData);
  }

  // Clear all data
  async clearAll() {
    for (const store of Storage.STORES) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        const request = os.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
    this.cache.clear();
  }

  // Get storage stats
  async getStats() {
    const stats = {};

    for (const store of Storage.STORES) {
      const items = await this.list(store);
      stats[store] = {
        count: items.length,
        size: JSON.stringify(items).length
      };
    }

    stats.cacheSize = this.cache.size;

    return stats;
  }
}

// Singleton
export const storage = new Storage();
