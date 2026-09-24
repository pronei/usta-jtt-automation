import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ObservationsSchema, inspectObservedCard } from "../pipeline/dry-run.js";
import type { Store } from "../storage/database.js";

/** Turns a PDF on disk into the observations JSON the parser writes. */
export type Extractor = (pdfPath: string, outDir: string) => Promise<unknown>;

export function pythonExtractor(pythonBin: string): Extractor {
  return async (pdfPath, outDir) => {
    await new Promise<void>((done, fail) => {
      const child = spawn(
        pythonBin,
        ["scripts/extract-digital-scorecards.py", pdfPath, outDir],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", fail);
      child.on("close", (code) =>
        code === 0
          ? done()
          : fail(new Error(`Scorecard parser exited ${code}: ${stderr.trim().slice(-500)}`)),
      );
    });
    return JSON.parse(await readFile(join(outDir, "observations.json"), "utf8"));
  };
}

export type IngestedCard = {
  job_id: string;
  match_id: string;
  home_team: string;
  away_team: string;
  code: string;
};

export async function ingestPdf(
  store: Store,
  extractor: Extractor,
  uploadDir: string,
  pdf: Buffer,
  actor: string,
): Promise<IngestedCard[]> {
  if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Not a PDF");
  const dir = resolve(uploadDir, randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const pdfPath = join(dir, "source.pdf");
  await writeFile(pdfPath, pdf, { mode: 0o600, flag: "wx" });
  const sha = createHash("sha256").update(pdf).digest("hex");
  const observations = ObservationsSchema.parse(await extractor(pdfPath, dir));
  if (observations.source_sha256 !== sha)
    throw new Error("Parser output does not match the uploaded file");
  const out: IngestedCard[] = [];
  for (const card of observations.cards) {
    const preflight = inspectObservedCard(card);
    const id = store.createJob({ original_sha256: sha, original_path: pdfPath }, actor);
    store.checkpoint(id, 0, "IMAGE_PREPARED", actor, {
      page: card.page,
      path: card.rendered_path,
      sha256: card.rendered_sha256,
      operations: ["PDF render at 1.5x; no rotation/cropping/contrast edits"],
    });
    store.checkpoint(id, 1, "MATCH_DISCOVERED", actor, {
      method: observations.extraction_method,
      discovery: preflight.discovery,
      observed_card: card,
      totals: preflight.totals,
      issues: preflight.issues,
    });
    out.push({
      job_id: id,
      match_id: card.match_id,
      home_team: card.home_team,
      away_team: card.away_team,
      code: store.issueCode(id, actor),
    });
  }
  return out;
}
