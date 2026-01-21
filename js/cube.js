/**
 * Cube - 9-node vertex system
 * 8 vertices (corners) + 1 central node
 * Each node runs a FemtoLLM instance
 * Vertices: NEU, NED, NWU, NWD, SEU, SED, SWU, SWD
 */

import { FemtoLLM } from './femtollm.js';

export class Cube {
  // Vertex names: Direction (N/S) + Direction (E/W) + Level (U/D)
  static VERTICES = ['NEU', 'NED', 'NWU', 'NWD', 'SEU', 'SED', 'SWU', 'SWD'];

  // Vertex 3D positions (normalized)
  static POSITIONS = {
    'NEU': [1, 1, 1],   'NED': [1, 1, 0],
    'NWU': [0, 1, 1],   'NWD': [0, 1, 0],
    'SEU': [1, 0, 1],   'SED': [1, 0, 0],
    'SWU': [0, 0, 1],   'SWD': [0, 0, 0],
    'CENTRAL': [0.5, 0.5, 0.5]
  };

  // Edge definitions (vertex pairs)
  static EDGES = [
    // Bottom face (D)
    ['NED', 'NWD'], ['NWD', 'SWD'], ['SWD', 'SED'], ['SED', 'NED'],
    // Top face (U)
    ['NEU', 'NWU'], ['NWU', 'SWU'], ['SWU', 'SEU'], ['SEU', 'NEU'],
    // Vertical edges
    ['NED', 'NEU'], ['NWD', 'NWU'], ['SWD', 'SWU'], ['SED', 'SEU']
  ];

  // Face diagonals
  static FACE_DIAGONALS = [
    ['NEU', 'SWU'], ['NWU', 'SEU'], // Top
    ['NED', 'SWD'], ['NWD', 'SED'], // Bottom
    ['NEU', 'SED'], ['NED', 'SEU'], // East
    ['NWU', 'SWD'], ['NWD', 'SWU'], // West
    ['NEU', 'NWD'], ['NED', 'NWU'], // North
    ['SEU', 'SWD'], ['SED', 'SWU']  // South
  ];

  // Space diagonals (through center)
  static SPACE_DIAGONALS = [
    ['NEU', 'SWD'], ['NWU', 'SED'], ['NED', 'SWU'], ['NWD', 'SEU']
  ];

  constructor(id) {
    this.id = id;

    // Create LLM at each vertex
    this.vertices = {};
    for (const v of Cube.VERTICES) {
      this.vertices[v] = new FemtoLLM(`${id}-${v}`);
    }

    // Central coordinator
    this.central = new FemtoLLM(`${id}-CENTRAL`);

    // Connections (adjacency list)
    this.connections = new Map();
    for (const v of Cube.VERTICES) {
      this.connections.set(v, new Set());
    }
    this.connections.set('CENTRAL', new Set());

    // Initialize edge connections
    for (const [a, b] of Cube.EDGES) {
      this.connect(a, b);
    }

    // Connect all vertices to central
    for (const v of Cube.VERTICES) {
      this.connect(v, 'CENTRAL');
    }

    // State machine (PackML-inspired)
    this.state = 'IDLE';
    this.stateHistory = [];

    // Message queue
    this.messageQueue = [];

    // Position in BlockArray (set when placed)
    this.position = null;
  }

  // Connect two nodes
  connect(a, b) {
    if (this.connections.has(a) && this.connections.has(b)) {
      this.connections.get(a).add(b);
      this.connections.get(b).add(a);
      return true;
    }
    return false;
  }

  // Disconnect two nodes
  disconnect(a, b) {
    if (this.connections.has(a) && this.connections.has(b)) {
      this.connections.get(a).delete(b);
      this.connections.get(b).delete(a);
      return true;
    }
    return false;
  }

  // Get node (vertex or central)
  getNode(name) {
    if (name === 'CENTRAL') return this.central;
    return this.vertices[name];
  }

  // Process at specific vertex
  async processVertex(vertex, text) {
    const node = this.getNode(vertex);
    if (!node) throw new Error(`Unknown vertex: ${vertex}`);
    return node.process(text);
  }

  // Process at central
  async processCentral(text) {
    return this.central.process(text);
  }

  // Broadcast to all vertices
  async broadcast(text) {
    const promises = Cube.VERTICES.map(v =>
      this.vertices[v].process(text)
    );
    const results = await Promise.all(promises);

    return Cube.VERTICES.reduce((acc, v, i) => {
      acc[v] = results[i];
      return acc;
    }, {});
  }

  // Send message between connected nodes
  async sendMessage(from, to, text) {
    if (!this.connections.get(from)?.has(to)) {
      throw new Error(`${from} and ${to} are not connected`);
    }

    const fromNode = this.getNode(from);
    const toNode = this.getNode(to);

    // Process through sender first
    const processed = await fromNode.process(`[TO:${to}] ${text}`);

    // Then through receiver
    const response = await toNode.process(`[FROM:${from}] ${processed}`);

    this.messageQueue.push({
      from, to, text, processed, response,
      timestamp: Date.now()
    });

    return response;
  }

  // Cascade process (propagate through connections)
  async cascade(startVertex, text, depth = 2) {
    const visited = new Set();
    const results = {};

    const process = async (vertex, input, d) => {
      if (d <= 0 || visited.has(vertex)) return;
      visited.add(vertex);

      const node = this.getNode(vertex);
      const output = await node.process(input);
      results[vertex] = output;

      // Propagate to connections
      const connections = Array.from(this.connections.get(vertex) || []);
      await Promise.all(connections.map(next =>
        process(next, output, d - 1)
      ));
    };

    await process(startVertex, text, depth);
    return results;
  }

  // Aggregate: collect from all vertices, process at central
  async aggregate(text) {
    // Broadcast first
    const vertexResults = await this.broadcast(text);

    // Combine and process at central
    const combined = Object.entries(vertexResults)
      .map(([v, r]) => `[${v}]: ${r}`)
      .join('\n');

    const centralResult = await this.central.process(
      `AGGREGATE:\n${combined}`
    );

    return { vertices: vertexResults, central: centralResult };
  }

  // State transitions
  setState(newState) {
    const validTransitions = {
      'IDLE': ['STARTING'],
      'STARTING': ['EXECUTE', 'ABORTING'],
      'EXECUTE': ['COMPLETING', 'HOLDING', 'ABORTING'],
      'COMPLETING': ['COMPLETE'],
      'COMPLETE': ['RESETTING'],
      'HOLDING': ['UNHOLDING', 'ABORTING'],
      'UNHOLDING': ['EXECUTE'],
      'ABORTING': ['ABORTED'],
      'ABORTED': ['RESETTING'],
      'RESETTING': ['IDLE']
    };

    if (validTransitions[this.state]?.includes(newState)) {
      this.stateHistory.push({ from: this.state, to: newState, time: Date.now() });
      this.state = newState;
      return true;
    }
    return false;
  }

  // Get vertex position in 3D space
  getVertexPosition(vertex, scale = 1, offset = [0, 0, 0]) {
    const pos = Cube.POSITIONS[vertex];
    return pos.map((p, i) => p * scale + offset[i]);
  }

  // Get face vertices
  getFace(face) {
    const faces = {
      'TOP': ['NEU', 'NWU', 'SWU', 'SEU'],
      'BOTTOM': ['NED', 'NWD', 'SWD', 'SED'],
      'NORTH': ['NEU', 'NWU', 'NWD', 'NED'],
      'SOUTH': ['SEU', 'SWU', 'SWD', 'SED'],
      'EAST': ['NEU', 'SEU', 'SED', 'NED'],
      'WEST': ['NWU', 'SWU', 'SWD', 'NWD']
    };
    return faces[face] || [];
  }

  // Serialize
  serialize() {
    const vertexData = {};
    for (const [v, llm] of Object.entries(this.vertices)) {
      vertexData[v] = llm.serialize();
    }

    const connectionData = {};
    for (const [k, v] of this.connections) {
      connectionData[k] = Array.from(v);
    }

    return {
      id: this.id,
      vertices: vertexData,
      central: this.central.serialize(),
      connections: connectionData,
      state: this.state,
      stateHistory: this.stateHistory.slice(-20),
      position: this.position,
      messageQueue: this.messageQueue.slice(-50)
    };
  }

  // Deserialize
  static deserialize(data) {
    const cube = new Cube(data.id);

    for (const [v, llmData] of Object.entries(data.vertices)) {
      cube.vertices[v] = FemtoLLM.deserialize(llmData);
    }
    cube.central = FemtoLLM.deserialize(data.central);

    cube.connections.clear();
    for (const [k, v] of Object.entries(data.connections)) {
      cube.connections.set(k, new Set(v));
    }

    cube.state = data.state;
    cube.stateHistory = data.stateHistory || [];
    cube.position = data.position;
    cube.messageQueue = data.messageQueue || [];

    return cube;
  }

  // Stats
  getStats() {
    const vertexStats = {};
    for (const [v, llm] of Object.entries(this.vertices)) {
      vertexStats[v] = llm.getStats();
    }

    return {
      id: this.id,
      state: this.state,
      position: this.position,
      vertices: vertexStats,
      central: this.central.getStats(),
      connectionCount: Array.from(this.connections.values())
        .reduce((sum, s) => sum + s.size, 0) / 2,
      messageCount: this.messageQueue.length
    };
  }
}
