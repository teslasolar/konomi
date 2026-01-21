# Konomi System

Distributed AI compute system for GitHub Pages. Pure CPU, no GPU needed.

## Quick Start

1. Open `index.html` in browser
2. Click "Run Demo" to create a sample setup
3. Explore BlockArrays, Cubes, eVGPU, and FemtoLLM views

## Architecture

```
konomi/
├── index.html          # Entry point
├── css/style.css       # UI styles
├── js/
│   ├── evgpu.js       # Electronic Virtual GPU (CPU tensor ops)
│   ├── femtollm.js    # 16-dim nano language model
│   ├── blockarray.js  # Sparse 1000^3 grid
│   ├── cube.js        # 9-node vertex system
│   ├── storage.js     # IndexedDB + static file storage
│   └── konomi.js      # Main orchestrator
└── data/
    ├── index.json     # Data manifest
    └── blocks/        # BlockArray chunk files
```

## Components

### eVGPU (Electronic Virtual GPU)
Pure CPU tensor operations using typed arrays and cache-optimized algorithms.

```javascript
import { evgpu } from './js/evgpu.js';

const a = evgpu.randn(4, 4);
const b = evgpu.randn(4, 4);
const c = evgpu.tensor(a, b, '@');  // Matrix multiply
```

Operations: `matmul(@)`, `add(+)`, `sub(-)`, `mul(*)`, `div(/)`, `relu`, `sigmoid`, `tanh`, `softmax`, `conv2d`, `maxPool`, `avgPool`

### FemtoLLM (16-dim Nano Model)
Minimal transformer running entirely in browser.

```javascript
import { FemtoLLM } from './js/femtollm.js';

const llm = new FemtoLLM('my-llm');
const output = await llm.process('Hello world');
```

Specs: 16 hidden dim | 1 layer | 1 head | ~4KB RAM | <100ms/inference

### BlockArray (Sparse 3D Grid)
Efficient storage for billion-cell grids using sparse maps.

```javascript
import { BlockArray } from './js/blockarray.js';

const ba = new BlockArray('main', [1000, 1000, 1000]);
ba.set(0, 0, 0, 1.0);
const llm = ba.getLLM(5, 5, 5);  // LLM at coordinate
```

### Cube (9-Node System)
8 vertices + 1 central, each running a FemtoLLM.

```javascript
import { Cube } from './js/cube.js';

const cube = new Cube('c1');
cube.connect('NEU', 'SWD');  // Diagonal connection
await cube.processVertex('NEU', 'input text');
await cube.broadcast('to all vertices');
await cube.cascade('NEU', 'propagate', 3);  // Depth 3
```

Vertices: `NEU, NED, NWU, NWD, SEU, SED, SWU, SWD` + `CENTRAL`

## Storage

Data persists in IndexedDB. Export to static JSON files for GitHub Pages hosting.

```javascript
import { konomi } from './js/konomi.js';

await konomi.saveState();           // Save to IndexedDB
await konomi.loadState();           // Load from IndexedDB
const files = konomi.exportStaticFiles();  // Generate static files
await konomi.loadFromStatic();      // Load from static files
```

## Performance Targets

| Component | Target |
|-----------|--------|
| FemtoLLM | <100ms/req, 4KB RAM |
| eVGPU | 100% CPU utilization |
| BlockArray | Sparse storage for 1B cells |
| Cube | 9 concurrent LLMs |
| Total footprint | <2GB RAM |

## GitHub Pages Deployment

1. Push to GitHub repository
2. Enable GitHub Pages (Settings > Pages > Source: main branch)
3. Access at `https://username.github.io/konomi/`

All data storage uses client-side IndexedDB - no server required.

## License

MIT
