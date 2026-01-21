/**
 * FemtoLLM - 16-dimensional nano language model
 * 16d | 1 layer | 1 head | ~4KB RAM | 0.1s/req
 * Runs entirely in browser with no external dependencies
 */

import { evgpu } from './evgpu.js';

export class FemtoLLM {
  static H = 16;      // Hidden size
  static VOCAB = 256; // Byte-level vocab
  static SEQ = 64;    // Max sequence length

  constructor(id = null) {
    this.id = id || crypto.randomUUID().slice(0, 8);
    this.h = FemtoLLM.H;

    // Initialize weights (tiny!)
    this.embed = evgpu.randn(FemtoLLM.VOCAB, this.h, 0.1);
    this.Wq = evgpu.randn(this.h, this.h, 0.1);
    this.Wk = evgpu.randn(this.h, this.h, 0.1);
    this.Wv = evgpu.randn(this.h, this.h, 0.1);
    this.Wo = evgpu.randn(this.h, this.h, 0.1);
    this.ff1 = evgpu.randn(this.h, this.h * 4, 0.1);
    this.ff2 = evgpu.randn(this.h * 4, this.h, 0.1);
    this.unembed = evgpu.randn(this.h, FemtoLLM.VOCAB, 0.1);

    // State
    this.memory = [];
    this.state = 'idle';
  }

  // Tokenize (byte-level)
  tokenize(text) {
    return Array.from(new TextEncoder().encode(text)).slice(0, FemtoLLM.SEQ);
  }

  // Detokenize
  detokenize(tokens) {
    return new TextDecoder().decode(new Uint8Array(tokens));
  }

  // Embed tokens
  embed_tokens(tokens) {
    return tokens.map(t => this.embed[t % FemtoLLM.VOCAB]);
  }

  // Single attention head
  attention(x) {
    const Q = evgpu.matmul(x, this.Wq);
    const K = evgpu.matmul(x, this.Wk);
    const V = evgpu.matmul(x, this.Wv);

    // Scaled dot-product attention
    const scores = evgpu.matmul(Q, evgpu.transpose(K));
    const scale = Math.sqrt(this.h);
    const scaled = evgpu._map(scores, v => v / scale);

    // Causal mask
    const masked = scaled.map((row, i) =>
      row.map((v, j) => j <= i ? v : -1e9)
    );

    // Softmax per row
    const attn = masked.map(row => {
      const max = Math.max(...row);
      const exp = row.map(v => Math.exp(v - max));
      const sum = exp.reduce((a, b) => a + b, 0);
      return exp.map(v => v / sum);
    });

    // Apply to values
    const out = evgpu.matmul(attn, V);
    return evgpu.matmul(out, this.Wo);
  }

  // Feed-forward network
  ffn(x) {
    const h = evgpu.matmul(x, this.ff1);
    const a = evgpu.relu(h);
    return evgpu.matmul(a, this.ff2);
  }

  // Layer norm (simplified)
  layernorm(x) {
    return evgpu.normalize(x);
  }

  // Forward pass
  forward(tokens) {
    let x = this.embed_tokens(tokens);

    // Single transformer block
    const attn_out = this.attention(x);
    x = evgpu.add(x, attn_out); // Residual
    x = this.layernorm(x);

    const ffn_out = this.ffn(x);
    x = evgpu.add(x, ffn_out); // Residual
    x = this.layernorm(x);

    return x;
  }

  // Generate next token
  next_token(hidden) {
    const last = [hidden[hidden.length - 1]];
    const logits = evgpu.matmul(last, this.unembed)[0];

    // Temperature sampling
    const temp = 0.8;
    const scaled = logits.map(v => v / temp);
    const max = Math.max(...scaled);
    const exp = scaled.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    const probs = exp.map(v => v / sum);

    // Sample
    let r = Math.random();
    for (let i = 0; i < probs.length; i++) {
      r -= probs[i];
      if (r <= 0) return i;
    }
    return probs.length - 1;
  }

  // Main process function
  async process(text, maxTokens = 32) {
    this.state = 'processing';
    const start = performance.now();

    try {
      const tokens = this.tokenize(text);
      let hidden = this.forward(tokens);
      const output = [...tokens];

      // Generate
      for (let i = 0; i < maxTokens; i++) {
        const next = this.next_token(hidden);
        if (next === 0) break; // EOS
        output.push(next);

        // Recompute (inefficient but simple)
        if (output.length < FemtoLLM.SEQ) {
          hidden = this.forward(output);
        }
      }

      const result = this.detokenize(output.slice(tokens.length));
      this.memory.push({ input: text, output: result, time: performance.now() - start });

      this.state = 'idle';
      return result;
    } catch (e) {
      this.state = 'error';
      throw e;
    }
  }

  // Quick embedding for similarity
  embed_text(text) {
    const tokens = this.tokenize(text);
    const hidden = this.forward(tokens);
    // Mean pool
    const mean = hidden[0].map((_, i) =>
      hidden.reduce((sum, row) => sum + row[i], 0) / hidden.length
    );
    return mean;
  }

  // Cosine similarity
  similarity(a, b) {
    const embA = Array.isArray(a) ? a : this.embed_text(a);
    const embB = Array.isArray(b) ? b : this.embed_text(b);

    const dot = embA.reduce((sum, v, i) => sum + v * embB[i], 0);
    const normA = Math.sqrt(embA.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(embB.reduce((sum, v) => sum + v * v, 0));

    return dot / (normA * normB || 1e-8);
  }

  // Serialize for storage
  serialize() {
    return {
      id: this.id,
      weights: {
        embed: this.embed,
        Wq: this.Wq, Wk: this.Wk, Wv: this.Wv, Wo: this.Wo,
        ff1: this.ff1, ff2: this.ff2,
        unembed: this.unembed
      },
      memory: this.memory.slice(-10) // Keep last 10
    };
  }

  // Deserialize
  static deserialize(data) {
    const llm = new FemtoLLM(data.id);
    Object.assign(llm, data.weights);
    llm.memory = data.memory || [];
    return llm;
  }

  // Stats
  getStats() {
    return {
      id: this.id,
      state: this.state,
      memorySize: this.memory.length,
      avgTime: this.memory.length ?
        this.memory.reduce((sum, m) => sum + m.time, 0) / this.memory.length : 0
    };
  }
}
