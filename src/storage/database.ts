import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertTransition,
  PipelineStateSchema,
  type PipelineState,
} from "../domain/pipeline-state.js";
import {
  ApprovedMatchSchema,
  ValidatedMatchSchema,
  type ApprovedMatch,
  type ValidatedMatch,
} from "../domain/schemas.js";
import { canonical, fingerprint } from "../domain/fingerprint.js";
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(hash TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),at TEXT NOT NULL,actor TEXT NOT NULL,event TEXT NOT NULL,artifact_hash TEXT REFERENCES artifacts(hash));
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS submissions(match_id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),fingerprint TEXT NOT NULL,status TEXT NOT NULL,receipt TEXT);
      CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_artifacts_update BEFORE UPDATE ON artifacts BEGIN SELECT RAISE(ABORT,'Immutable artifact'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_artifacts_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT,'Immutable artifact'); END;`);
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private event(job: string, actor: string, event: string, data: unknown) {
    if (!actor.trim()) throw new Error("Actor required");
    const json = canonical(data),
      hash = fingerprint(data);
    this.db
      .prepare("INSERT OR IGNORE INTO artifacts VALUES(?,?)")
      .run(hash, json);
    this.db
      .prepare(
        "INSERT INTO events(job_id,at,actor,event,artifact_hash) VALUES(?,?,?,?,?)",
      )
      .run(job, new Date().toISOString(), actor, event, hash);
  }
  createJob(
    image: { original_sha256: string; original_path: string },
    actor: string,
  ): string {
    const id = randomUUID();
    return this.transaction(() => {
      this.db.prepare("INSERT INTO jobs VALUES(?,'RECEIVED',0)").run(id);
      this.event(id, actor, "RECEIVED", image);
      return id;
    });
  }
  getJob(id: string): { id: string; state: PipelineState; revision: number } {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (!row) throw new Error("Unknown job");
    return {
      id: String(row.id),
      state: PipelineStateSchema.parse(row.state),
      revision: Number(row.revision),
    };
  }
  history(id: string) {
    return this.db
      .prepare(
        "SELECT e.*,a.json FROM events e JOIN artifacts a ON a.hash=e.artifact_hash WHERE job_id=? ORDER BY seq",
      )
      .all(id);
  }
  private move(
    id: string,
    revision: number,
    next: PipelineState,
    actor: string,
    data: unknown,
  ) {
    const job = this.getJob(id);
    if (job.revision !== revision) throw new Error("Stale job revision");
    assertTransition(job.state, next);
    this.db
      .prepare("UPDATE jobs SET state=?,revision=revision+1 WHERE id=?")
      .run(next, id);
    this.event(id, actor, next, data);
  }
  checkpoint(
    id: string,
    revision: number,
    next: PipelineState,
    actor: string,
    data: unknown,
  ) {
    if (
      ["APPROVED", "SUBMITTING", "SUBMITTED", "SUBMISSION_UNKNOWN"].includes(
        next,
      )
    )
      throw new Error("Use controlled approval/submission methods");
    this.transaction(() => this.move(id, revision, next, actor, data));
  }
  approve(
    id: string,
    revision: number,
    value: ValidatedMatch,
    actor: string,
  ): ApprovedMatch {
    const validation = ValidatedMatchSchema.parse(value);
    return this.transaction(() => {
      const latest = this.db
        .prepare(
          "SELECT a.json FROM events e JOIN artifacts a ON a.hash=e.artifact_hash WHERE e.job_id=? AND e.event='VALIDATED' ORDER BY e.seq DESC LIMIT 1",
        )
        .get(id);
      if (
        !latest ||
        fingerprint(JSON.parse(String(latest.json))) !== fingerprint(validation)
      )
        throw new Error("Approval must bind the persisted validation");
      const approved = ApprovedMatchSchema.parse({
        kind: "approved",
        validation,
        approval_id: randomUUID(),
        approved_by: actor,
        approved_at: new Date().toISOString(),
      });
      this.move(id, revision, "APPROVED", actor, approved);
      this.db
        .prepare("INSERT INTO approvals VALUES(?,?,?)")
        .run(approved.approval_id, id, canonical(approved));
      return approved;
    });
  }
  assertApproval(id: string, raw: ApprovedMatch): ApprovedMatch {
    const approved = ApprovedMatchSchema.parse(raw),
      row = this.db
        .prepare("SELECT json FROM approvals WHERE id=? AND job_id=?")
        .get(approved.approval_id, id);
    if (!row || String(row.json) !== canonical(approved))
      throw new Error("Approval missing or modified");
    return approved;
  }
  reserveSubmission(id: string, revision: number, approved: ApprovedMatch) {
    this.transaction(() => {
      this.assertApproval(id, approved);
      // Match-level uniqueness blocks both exact duplicates and changed-score submissions across jobs.
      this.db
        .prepare("INSERT INTO submissions VALUES(?,?,?,'SUBMITTING',NULL)")
        .run(
          approved.validation.payload.match_id,
          id,
          fingerprint(approved.validation.payload),
        );
      this.move(id, revision, "SUBMITTING", approved.approved_by, {
        approval_id: approved.approval_id,
      });
    });
  }
  completeSubmission(id: string, receipt: string, actor: string) {
    if (!receipt.trim()) throw new Error("Official receipt required");
    this.transaction(() => {
      const row = this.db
        .prepare("SELECT match_id FROM submissions WHERE job_id=?")
        .get(id);
      if (!row) throw new Error("No reservation");
      this.move(id, this.getJob(id).revision, "SUBMITTED", actor, { receipt });
      this.db
        .prepare(
          "UPDATE submissions SET status='SUBMITTED',receipt=? WHERE job_id=?",
        )
        .run(receipt, id);
    });
  }
  markSubmissionUnknown(id: string, actor: string) {
    this.transaction(() => {
      this.move(id, this.getJob(id).revision, "SUBMISSION_UNKNOWN", actor, {
        reason:
          "Outcome uncertain; manually reconcile official result. Never retry automatically.",
      });
      this.db
        .prepare(
          "UPDATE submissions SET status='SUBMISSION_UNKNOWN' WHERE job_id=?",
        )
        .run(id);
    });
  }
}
