import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRotatingWriter } from "./rotate.js";
import type { RotateConfig } from "./types.js";

export type TelemetryWriter = {
  write: (evt: object) => void;
  flush: () => Promise<void>;
};

export function createTelemetryWriter(filePath: string, rotateConfig?: RotateConfig): TelemetryWriter {
  let queue: string[] = [];
  let flushing = false;
  const rotator = createRotatingWriter(filePath, rotateConfig ?? {});

  const doFlush = async () => {
    if (flushing || queue.length === 0) {
      return;
    }
    flushing = true;
    const batch = queue;
    queue = [];
    try {
      if (rotator.shouldRotate()) {
        await rotator.rotate();
      }
      await mkdir(dirname(filePath), { recursive: true });
      const data = batch.join("");
      await appendFile(filePath, data);
      rotator.trackWrite(Buffer.byteLength(data, "utf8"));
    } finally {
      flushing = false;
    }
    if (queue.length > 0) {
      void doFlush();
    }
  };

  void rotator.init();

  return {
    write(evt: object) {
      const line = JSON.stringify(evt) + "\n";
      queue.push(line);
      if (!flushing) {
        void doFlush();
      }
    },
    async flush() {
      while (queue.length > 0 || flushing) {
        await doFlush();
        if (flushing) {
          await new Promise((r) => setTimeout(r, 10));
        }
      }
    },
  };
}
