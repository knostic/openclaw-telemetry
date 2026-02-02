import { readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { createRotatingWriter } from "./rotate.js";

const TEST_DIR = join(import.meta.dirname, ".test-output-rotate");

describe("createRotatingWriter", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("does nothing when disabled", async () => {
    const filePath = join(TEST_DIR, "test.jsonl");
    const rotator = createRotatingWriter(filePath, { enabled: false });
    expect(rotator.shouldRotate()).toBe(false);
    await rotator.rotate();
  });

  test("tracks size and triggers rotation", async () => {
    const filePath = join(TEST_DIR, "test.jsonl");
    const rotator = createRotatingWriter(filePath, { enabled: true, maxSizeBytes: 100, compress: false });
    await rotator.init();

    rotator.trackWrite(50);
    expect(rotator.shouldRotate()).toBe(false);

    rotator.trackWrite(60);
    expect(rotator.shouldRotate()).toBe(true);
  });

  test("rotates files correctly", async () => {
    const filePath = join(TEST_DIR, "test.jsonl");
    await writeFile(filePath, "original content\n");

    const rotator = createRotatingWriter(filePath, { enabled: true, maxSizeBytes: 10, compress: false });
    await rotator.init();
    await rotator.rotate();

    const files = await readdir(TEST_DIR);
    expect(files).toContain("test.jsonl.1");

    const content = await readFile(join(TEST_DIR, "test.jsonl.1"), "utf8");
    expect(content).toBe("original content\n");
  });

  test("compresses rotated files", async () => {
    const filePath = join(TEST_DIR, "test.jsonl");
    await writeFile(filePath, "content to compress\n");

    const rotator = createRotatingWriter(filePath, { enabled: true, maxSizeBytes: 10, compress: true });
    await rotator.init();
    await rotator.rotate();

    const files = await readdir(TEST_DIR);
    expect(files).toContain("test.jsonl.1.gz");
    expect(files).not.toContain("test.jsonl.1");

    const chunks: Buffer[] = [];
    await pipeline(
      createReadStream(join(TEST_DIR, "test.jsonl.1.gz")),
      createGunzip(),
      new Writable({
        write(chunk, _, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
    );
    expect(Buffer.concat(chunks).toString()).toBe("content to compress\n");
  });

  test("keeps only maxFiles rotated files", async () => {
    const filePath = join(TEST_DIR, "test.jsonl");

    for (let i = 1; i <= 5; i++) {
      await writeFile(join(TEST_DIR, `test.jsonl.${i}`), `old ${i}\n`);
    }
    await writeFile(filePath, "current\n");

    const rotator = createRotatingWriter(filePath, { enabled: true, maxSizeBytes: 10, maxFiles: 3, compress: false });
    await rotator.init();
    await rotator.rotate();

    const files = await readdir(TEST_DIR);
    const rotatedFiles = files.filter((f) => f.match(/test\.jsonl\.\d+$/));
    expect(rotatedFiles.length).toBeLessThanOrEqual(3);
  });

  test("resets size after rotation", async () => {
    const filePath = join(TEST_DIR, "test.jsonl");
    await writeFile(filePath, "x".repeat(100));

    const rotator = createRotatingWriter(filePath, { enabled: true, maxSizeBytes: 50, compress: false });
    await rotator.init();
    expect(rotator.shouldRotate()).toBe(true);

    await rotator.rotate();
    expect(rotator.shouldRotate()).toBe(false);
  });
});
