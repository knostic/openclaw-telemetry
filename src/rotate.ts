import { createReadStream, createWriteStream } from "node:fs";
import { readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { RotateConfig } from "./types.js";

export function createRotatingWriter(filePath: string, config: RotateConfig = {}) {
  if (!config.enabled) {
    return {
      shouldRotate: () => false,
      rotate: async () => {},
      trackWrite: () => {},
      init: async () => {},
    };
  }

  const maxSize = config.maxSizeBytes ?? 10 * 1024 * 1024;
  const maxFiles = config.maxFiles ?? 5;
  const compress = config.compress ?? true;
  let currentSize = 0;
  let rotating = false;

  async function getCurrentSize(): Promise<number> {
    try {
      const s = await stat(filePath);
      return s.size;
    } catch {
      return 0;
    }
  }

  async function compressFile(src: string, dest: string): Promise<void> {
    const gzip = createGzip();
    const source = createReadStream(src);
    const destination = createWriteStream(dest);
    await pipeline(source, gzip, destination);
    await unlink(src);
  }

  async function rotateFiles(): Promise<void> {
    const dir = dirname(filePath);
    const base = basename(filePath);
    const ext = compress ? ".gz" : "";

    for (let i = maxFiles - 1; i >= 1; i--) {
      const oldPath = join(dir, `${base}.${i}${ext}`);
      const newPath = join(dir, `${base}.${i + 1}${ext}`);
      try {
        await rename(oldPath, newPath);
      } catch {
        // File doesn't exist, skip
      }
    }

    if (maxFiles >= 1) {
      const rotatedPath = join(dir, `${base}.1`);
      await rename(filePath, rotatedPath);
      if (compress) {
        await compressFile(rotatedPath, rotatedPath + ".gz");
      }
    }

    await cleanupOldFiles(dir, base, ext);
  }

  async function cleanupOldFiles(dir: string, base: string, ext: string): Promise<void> {
    try {
      const files = await readdir(dir);
      const pattern = new RegExp(`^${base.replace(/\./g, "\\.")}\\.(\\d+)${ext.replace(/\./g, "\\.")}$`);
      for (const f of files) {
        const match = f.match(pattern);
        if (match && parseInt(match[1], 10) > maxFiles) {
          await unlink(join(dir, f));
        }
      }
    } catch {
      // Directory read failed, skip cleanup
    }
  }

  return {
    shouldRotate(): boolean {
      return currentSize >= maxSize;
    },
    trackWrite(bytes: number): void {
      currentSize += bytes;
    },
    async rotate(): Promise<void> {
      if (rotating) return;
      rotating = true;
      try {
        await rotateFiles();
        currentSize = 0;
      } finally {
        rotating = false;
      }
    },
    async init(): Promise<void> {
      currentSize = await getCurrentSize();
    },
  };
}
