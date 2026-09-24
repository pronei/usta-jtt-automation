import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/database.js";
import { ingestPdf, type Extractor } from "../src/web/upload.js";
import { observations } from "./web-fixtures.js";

export const fakeExtractor: Extractor = async (pdfPath) => ({
  ...observations,
  source_path: pdfPath,
  source_sha256: createHash("sha256").update(await readFile(pdfPath)).digest("hex"),
});
export const pdf = Buffer.from("%PDF-1.4 test document");

test("ingest creates one job per card at MATCH_DISCOVERED and issues a code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jtt-upload-"));
  const store = new Store(":memory:");
  try {
    const cards = await ingestPdf(store, fakeExtractor, dir, pdf, "coach");
    assert.equal(cards.length, 1);
    const c = cards[0]!;
    assert.equal(c.match_id, "123456");
    assert.equal(store.getJob(c.job_id).state, "MATCH_DISCOVERED");
    assert.equal(store.resolveCode(c.code)?.job_id, c.job_id);
    const discovered = store.latestArtifact(c.job_id, "MATCH_DISCOVERED") as {
      observed_card: { match_id: string };
      totals: { match: boolean };
    };
    assert.equal(discovered.observed_card.match_id, "123456");
    assert.equal(discovered.totals.match, true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ingest refuses non-PDF bytes and parser output for a different file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jtt-upload-"));
  const store = new Store(":memory:");
  try {
    await assert.rejects(
      ingestPdf(store, fakeExtractor, dir, Buffer.from("hello"), "coach"),
      /Not a PDF/,
    );
    const wrong: Extractor = async (p, o) => ({
      ...((await fakeExtractor(p, o)) as Record<string, unknown>),
      source_sha256: "0".repeat(64),
    });
    await assert.rejects(ingestPdf(store, wrong, dir, pdf, "coach"), /does not match/);
    assert.equal(store.listJobs().length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
