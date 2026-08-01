// Portable worker-compatible processors. They run as queued local tasks so file://
// mode does not depend on module workers or cross-origin loading.
class PortableWorkerBridge {
  constructor(processorFactory) {
    this.listeners = { message: new Set(), error: new Set() };
    this.closed = false;
    const emitMessage = (data) => queueMicrotask(() => this.emit("message", { data }));
    const emitError = (error) => queueMicrotask(() => this.emit("error", error));
    this.processor = processorFactory(emitMessage, emitError);
  }

  addEventListener(type, listener) {
    this.listeners[type]?.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type]?.delete(listener);
  }

  postMessage(message) {
    if (this.closed) return;
    setTimeout(() => {
      if (this.closed) return;
      try {
        this.processor(message);
      } catch (error) {
        this.emit("error", error);
      }
    }, 0);
  }

  terminate() {
    this.closed = true;
    this.listeners.message.clear();
    this.listeners.error.clear();
  }

  emit(type, event) {
    for (const listener of this.listeners[type] || []) {
      try { listener(event); } catch (error) { console.error(error); }
    }
  }
}

function createPortableSenderWorker() {
  return new PortableWorkerBridge((emit) => {
    let opticalEncoder = null;
    let sessionId = null;
    let totalLength = 0;
    let blockLength = 0;
    let correctionLevel = "M";
    let nextSequence = 0;
    let generation = 0;

    return (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "init") {
        generation += 1;
        const payload = new Uint8Array(message.payload);
        sessionId = new Uint8Array(message.sessionId);
        totalLength = payload.length;
        blockLength = message.blockLength;
        correctionLevel = message.correctionLevel;
        nextSequence = 0;
        opticalEncoder = new LTEncoder(payload, blockLength, sessionSeed(sessionId));
        emit({ type: "ready", blockCount: opticalEncoder.blockCount, generation });
        return;
      }
      if (message.type === "reset") {
        generation += 1;
        opticalEncoder = null;
        sessionId = null;
        return;
      }
      if (message.type !== "generate" || !opticalEncoder || !sessionId) return;
      if (message.generation !== generation) return;

      const count = Math.max(1, Math.min(8, Number(message.count) || 1));
      try {
        const frames = [];
        for (let index = 0; index < count; index += 1) {
          const sequence = nextSequence >>> 0;
          nextSequence = (nextSequence + 1) >>> 0;
          const block = opticalEncoder.encode(sequence);
          const packed = packFrame({
            sessionId,
            sequence,
            blockCount: opticalEncoder.blockCount,
            blockLength,
            totalLength,
          }, block);
          const text = FRAME_PREFIX + bytesToBase64Url(packed);
          const matrix = createQrMatrix(text, correctionLevel);
          frames.push({ sequence, size: matrix.size, modules: matrix.modules.buffer, textLength: text.length });
        }
        emit({ type: "frames", frames, generation });
      } catch (error) {
        emit({ type: "error", message: error instanceof Error ? error.message : String(error), generation });
      }
    };
  });
}

function createPortableDecoderWorker() {
  return new PortableWorkerBridge((emit) => {
    let opticalDecoder = null;
    let lockedDescriptor = "";
    let lockedSession = "";
    let completed = false;
    const stats = { valid: 0, invalid: 0, foreign: 0, mismatch: 0, duplicate: 0 };

    const reset = () => {
      opticalDecoder = null;
      lockedDescriptor = "";
      lockedSession = "";
      completed = false;
      for (const key of Object.keys(stats)) stats[key] = 0;
    };

    const emitProgress = (state) => emit({
      type: "progress",
      state,
      stats: { ...stats },
      framesNew: opticalDecoder?.framesNew ?? 0,
      solved: opticalDecoder?.solvedCount ?? 0,
      blockCount: opticalDecoder?.blockCount ?? 0,
    });

    return (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "reset") {
        reset();
        emit({ type: "reset" });
        return;
      }
      if (message.type !== "frame" || completed || typeof message.value !== "string") return;
      const value = message.value;
      if (!value.startsWith(FRAME_PREFIX)) return;

      let parsed;
      try { parsed = parseFrame(base64UrlToBytes(value.slice(FRAME_PREFIX.length))); }
      catch { parsed = null; }
      if (!parsed) {
        stats.invalid += 1;
        emitProgress("damaged");
        return;
      }

      const sessionHex = sessionIdToHex(parsed.header.sessionId);
      const descriptor = descriptorKey(parsed.header);
      if (!opticalDecoder) {
        opticalDecoder = new LTDecoder(
          parsed.header.blockCount,
          parsed.header.blockLength,
          sessionSeed(parsed.header.sessionId),
          parsed.header.totalLength,
        );
        lockedSession = sessionHex;
        lockedDescriptor = descriptor;
        emit({
          type: "locked",
          session: sessionHex.slice(0, 12).toUpperCase(),
          blockCount: parsed.header.blockCount,
          blockLength: parsed.header.blockLength,
          totalLength: parsed.header.totalLength,
        });
      } else if (sessionHex !== lockedSession) {
        stats.foreign += 1;
        emitProgress("other-session");
        return;
      } else if (descriptor !== lockedDescriptor) {
        stats.mismatch += 1;
        emitProgress("incompatible");
        return;
      }

      const previousDuplicates = opticalDecoder.framesDuplicate;
      opticalDecoder.addFrame(parsed.header.sequence, parsed.block);
      stats.valid += 1;
      if (opticalDecoder.framesDuplicate > previousDuplicates) stats.duplicate += 1;

      if (opticalDecoder.isComplete) {
        const assembled = opticalDecoder.assemble();
        if (!assembled) {
          emit({ type: "fatal", message: "The decoder completed without an output buffer." });
          return;
        }
        completed = true;
        emit({
          type: "complete",
          payload: assembled.buffer,
          stats: { ...stats },
          framesNew: opticalDecoder.framesNew,
          solved: opticalDecoder.solvedCount,
          blockCount: opticalDecoder.blockCount,
        });
        return;
      }
      emitProgress("receiving");
    };
  });
}
