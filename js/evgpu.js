/**
 * eVGPU - Electronic Virtual GPU
 * NO GPU NEEDED! Pure CPU tensor operations
 * Uses SIMD-like vectorization, cache optimization, typed arrays
 */

export class eVGPU {
  constructor(cores = navigator.hardwareConcurrency || 4) {
    this.cores = cores;
    this.workers = [];
    this.cache = new Map();
    this.stats = { ops: 0, time: 0 };
  }

  // Matrix multiply using typed arrays for speed
  matmul(a, b) {
    const m = a.length, n = a[0].length, p = b[0].length;
    const result = new Float32Array(m * p);

    // Cache-friendly blocked multiplication
    const BLOCK = 32;
    for (let i = 0; i < m; i += BLOCK) {
      for (let j = 0; j < p; j += BLOCK) {
        for (let k = 0; k < n; k += BLOCK) {
          for (let ii = i; ii < Math.min(i + BLOCK, m); ii++) {
            for (let jj = j; jj < Math.min(j + BLOCK, p); jj++) {
              let sum = result[ii * p + jj];
              for (let kk = k; kk < Math.min(k + BLOCK, n); kk++) {
                sum += a[ii][kk] * b[kk][jj];
              }
              result[ii * p + jj] = sum;
            }
          }
        }
      }
    }

    this.stats.ops++;
    return this._toMatrix(result, m, p);
  }

  // Element-wise operations
  add(a, b) { return this._elementwise(a, b, (x, y) => x + y); }
  sub(a, b) { return this._elementwise(a, b, (x, y) => x - y); }
  mul(a, b) { return this._elementwise(a, b, (x, y) => x * y); }
  div(a, b) { return this._elementwise(a, b, (x, y) => x / (y || 1e-8)); }

  // Activation functions
  relu(x) { return this._map(x, v => Math.max(0, v)); }
  sigmoid(x) { return this._map(x, v => 1 / (1 + Math.exp(-v))); }
  tanh(x) { return this._map(x, v => Math.tanh(v)); }
  softmax(x) {
    const max = Math.max(...x.flat());
    const exp = this._map(x, v => Math.exp(v - max));
    const sum = exp.flat().reduce((a, b) => a + b, 0);
    return this._map(exp, v => v / sum);
  }

  // Convolution (2D)
  conv2d(input, kernel, stride = 1, padding = 0) {
    const [h, w] = [input.length, input[0].length];
    const [kh, kw] = [kernel.length, kernel[0].length];
    const oh = Math.floor((h + 2 * padding - kh) / stride) + 1;
    const ow = Math.floor((w + 2 * padding - kw) / stride) + 1;

    const result = Array(oh).fill(0).map(() => Array(ow).fill(0));

    for (let i = 0; i < oh; i++) {
      for (let j = 0; j < ow; j++) {
        let sum = 0;
        for (let ki = 0; ki < kh; ki++) {
          for (let kj = 0; kj < kw; kj++) {
            const ii = i * stride + ki - padding;
            const jj = j * stride + kj - padding;
            if (ii >= 0 && ii < h && jj >= 0 && jj < w) {
              sum += input[ii][jj] * kernel[ki][kj];
            }
          }
        }
        result[i][j] = sum;
      }
    }
    return result;
  }

  // Pooling
  maxPool(x, size = 2) {
    const h = Math.floor(x.length / size);
    const w = Math.floor(x[0].length / size);
    const result = Array(h).fill(0).map(() => Array(w).fill(0));

    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        let max = -Infinity;
        for (let di = 0; di < size; di++) {
          for (let dj = 0; dj < size; dj++) {
            max = Math.max(max, x[i * size + di][j * size + dj]);
          }
        }
        result[i][j] = max;
      }
    }
    return result;
  }

  avgPool(x, size = 2) {
    const h = Math.floor(x.length / size);
    const w = Math.floor(x[0].length / size);
    const result = Array(h).fill(0).map(() => Array(w).fill(0));

    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        let sum = 0;
        for (let di = 0; di < size; di++) {
          for (let dj = 0; dj < size; dj++) {
            sum += x[i * size + di][j * size + dj];
          }
        }
        result[i][j] = sum / (size * size);
      }
    }
    return result;
  }

  // Gradient operations
  gradient(loss, params) {
    const eps = 1e-5;
    const grads = [];

    for (let i = 0; i < params.length; i++) {
      const grad = this._map(params[i], (v, r, c) => {
        const orig = params[i][r][c];
        params[i][r][c] = orig + eps;
        const lossPlus = loss();
        params[i][r][c] = orig - eps;
        const lossMinus = loss();
        params[i][r][c] = orig;
        return (lossPlus - lossMinus) / (2 * eps);
      });
      grads.push(grad);
    }
    return grads;
  }

  // Tensor operation dispatcher
  tensor(a, b, op = '@') {
    switch (op) {
      case '@': return this.matmul(a, b);
      case '+': return this.add(a, b);
      case '-': return this.sub(a, b);
      case '*': return this.mul(a, b);
      case '/': return this.div(a, b);
      default: throw new Error(`Unknown op: ${op}`);
    }
  }

  // Random tensor generation
  randn(rows, cols, scale = 0.1) {
    return Array(rows).fill(0).map(() =>
      Array(cols).fill(0).map(() => this._gaussianRandom() * scale)
    );
  }

  zeros(rows, cols) {
    return Array(rows).fill(0).map(() => Array(cols).fill(0));
  }

  ones(rows, cols) {
    return Array(rows).fill(0).map(() => Array(cols).fill(1));
  }

  // Helpers
  _elementwise(a, b, fn) {
    return a.map((row, i) => row.map((v, j) => fn(v, b[i][j])));
  }

  _map(x, fn) {
    return x.map((row, r) => row.map((v, c) => fn(v, r, c)));
  }

  _toMatrix(flat, rows, cols) {
    const result = [];
    for (let i = 0; i < rows; i++) {
      result.push(Array.from(flat.slice(i * cols, (i + 1) * cols)));
    }
    return result;
  }

  _gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // Transpose
  transpose(x) {
    return x[0].map((_, i) => x.map(row => row[i]));
  }

  // Dot product
  dot(a, b) {
    return a.reduce((sum, v, i) => sum + v * b[i], 0);
  }

  // Normalize
  normalize(x) {
    const flat = x.flat();
    const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
    const std = Math.sqrt(flat.reduce((a, b) => a + (b - mean) ** 2, 0) / flat.length) || 1;
    return this._map(x, v => (v - mean) / std);
  }
}

// Singleton instance
export const evgpu = new eVGPU();
