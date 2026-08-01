// @ts-check
import { splitmix32 } from "./protocol.js";

const LN2 = 0.6931471805599453;
const SOLITON_C = 0.1;
const SOLITON_DELTA = 0.5;

function deterministicLog(value) {
  let exponent = 0;
  let mantissa = value;
  while (mantissa >= 1.5) { mantissa /= 2; exponent += 1; }
  while (mantissa < 0.75) { mantissa *= 2; exponent -= 1; }
  const z = (mantissa - 1) / (mantissa + 1);
  const zSquared = z * z;
  let term = z;
  let sum = 0;
  for (let n = 1; n <= 21; n += 2) { sum += term / n; term *= zSquared; }
  return exponent * LN2 + 2 * sum;
}

function solitonCdf(blockCount) {
  const cdf = new Float64Array(blockCount);
  if (blockCount === 1) { cdf[0] = 1; return cdf; }
  const r = Math.max(1, SOLITON_C * deterministicLog(blockCount / SOLITON_DELTA) * Math.sqrt(blockCount));
  const spike = Math.min(blockCount, Math.ceil(blockCount / r));
  let total = 0;
  for (let degree = 1; degree <= blockCount; degree += 1) {
    const rho = degree === 1 ? 1 / blockCount : 1 / (degree * (degree - 1));
    let tau = 0;
    if (degree < spike) tau = r / (degree * blockCount);
    else if (degree === spike) tau = (r * Math.max(0, deterministicLog(r / SOLITON_DELTA))) / blockCount;
    total += rho + tau;
    cdf[degree - 1] = total;
  }
  for (let index = 0; index < blockCount; index += 1) cdf[index] /= total;
  cdf[blockCount - 1] = 1;
  return cdf;
}

function frameSeed(seed, sequence) {
  let hash = (Math.imul((seed + 1) | 0, 0x9e3779b1) ^ ((sequence + 0x85ebca6b) | 0)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) | 0;
}

function frameIndices(blockCount, cdf, seed, sequence) {
  const random = splitmix32(frameSeed(seed, sequence));
  const sample = random() * 2 ** -32;
  let low = 0;
  let high = blockCount - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cdf[middle] >= sample) high = middle;
    else low = middle + 1;
  }
  const degree = Math.min(blockCount, low + 1);
  if (degree > blockCount >> 3) {
    const scratch = new Uint32Array(blockCount);
    for (let index = 0; index < blockCount; index += 1) scratch[index] = index;
    const output = new Array(degree);
    for (let index = 0; index < degree; index += 1) {
      const swapIndex = index + (random() % (blockCount - index));
      const temporary = scratch[index];
      scratch[index] = scratch[swapIndex];
      scratch[swapIndex] = temporary;
      output[index] = scratch[index];
    }
    return output;
  }
  const set = new Set();
  while (set.size < degree) set.add(random() % blockCount);
  return [...set];
}

function xorInto(destination, source) {
  for (let index = 0; index < destination.length; index += 1) destination[index] = (destination[index] ^ source[index]) >>> 0;
}

export class LTEncoder {
  constructor(payload, blockLength, seed) {
    if (!(payload instanceof Uint8Array) || payload.length === 0) throw new Error("Payload cannot be empty.");
    if (!Number.isInteger(blockLength) || blockLength < 1) throw new Error("Invalid block length.");
    this.blockLength = blockLength;
    this.seed = seed >>> 0;
    this.blockCount = Math.max(1, Math.ceil(payload.length / blockLength));
    this.wordCount = Math.ceil(blockLength / 4);
    this.blocks = new Uint32Array(this.blockCount * this.wordCount);
    const targetBytes = new Uint8Array(this.blocks.buffer);
    for (let block = 0; block < this.blockCount; block += 1) {
      const source = payload.subarray(block * blockLength, Math.min((block + 1) * blockLength, payload.length));
      targetBytes.set(source, block * this.wordCount * 4);
    }
    this.cdf = solitonCdf(this.blockCount);
  }

  encode(sequence) {
    const indices = frameIndices(this.blockCount, this.cdf, this.seed, sequence >>> 0);
    const output = new Uint32Array(this.wordCount);
    for (const block of indices) {
      const offset = block * this.wordCount;
      for (let word = 0; word < this.wordCount; word += 1) output[word] = (output[word] ^ this.blocks[offset + word]) >>> 0;
    }
    return new Uint8Array(output.buffer, 0, this.blockLength);
  }
}

export class LTDecoder {
  constructor(blockCount, blockLength, seed, totalLength) {
    this.blockCount = blockCount;
    this.blockLength = blockLength;
    this.seed = seed >>> 0;
    this.totalLength = totalLength;
    this.wordCount = Math.ceil(blockLength / 4);
    this.cdf = solitonCdf(blockCount);
    this.solved = new Array(blockCount).fill(null);
    this.byBlock = new Map();
    this.seen = new Set();
    this.solvedCount = 0;
    this.framesNew = 0;
    this.framesDuplicate = 0;
  }

  get isComplete() { return this.solvedCount >= this.blockCount; }

  addFrame(sequence, block) {
    const normalizedSequence = sequence >>> 0;
    if (this.seen.has(normalizedSequence)) { this.framesDuplicate += 1; return false; }
    this.seen.add(normalizedSequence);
    this.framesNew += 1;
    if (this.isComplete) return false;

    const indices = new Set(frameIndices(this.blockCount, this.cdf, this.seed, normalizedSequence));
    const words = new Uint32Array(this.wordCount);
    new Uint8Array(words.buffer).set(block.subarray(0, this.blockLength));
    for (const blockIndex of [...indices]) {
      const solved = this.solved[blockIndex];
      if (solved) { xorInto(words, solved); indices.delete(blockIndex); }
    }
    if (indices.size === 0) return true;
    if (indices.size === 1) { this.resolve(indices.values().next().value, words); return true; }

    const pending = { indices, words };
    for (const blockIndex of indices) {
      let waiting = this.byBlock.get(blockIndex);
      if (!waiting) { waiting = new Set(); this.byBlock.set(blockIndex, waiting); }
      waiting.add(pending);
    }
    return true;
  }

  resolve(initialBlock, initialWords) {
    const queue = [[initialBlock, initialWords]];
    while (queue.length > 0) {
      const [block, words] = queue.pop();
      if (this.solved[block]) continue;
      this.solved[block] = words;
      this.solvedCount += 1;
      const waiting = this.byBlock.get(block);
      if (!waiting) continue;
      this.byBlock.delete(block);
      for (const pending of waiting) {
        xorInto(pending.words, words);
        pending.indices.delete(block);
        if (pending.indices.size === 1) {
          const remaining = pending.indices.values().next().value;
          this.byBlock.get(remaining)?.delete(pending);
          if (!this.solved[remaining]) queue.push([remaining, pending.words]);
        }
      }
    }
  }

  assemble() {
    if (!this.isComplete) return null;
    const output = new Uint8Array(this.totalLength);
    for (let block = 0; block < this.blockCount; block += 1) {
      const start = block * this.blockLength;
      const length = Math.min(this.blockLength, this.totalLength - start);
      if (length > 0) output.set(new Uint8Array(this.solved[block].buffer, 0, length), start);
    }
    return output;
  }
}
