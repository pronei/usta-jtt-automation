import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage/database.js";

test("listJobs, latestArtifact and annotate", () => {
  const store = new Store(":memory:");
  try {
    const a = store.createJob({ original_sha256: "a", original_path: "a.pdf" }, "coach");
    const b = store.createJob({ original_sha256: "b", original_path: "b.pdf" }, "coach");
    assert.deepEqual(store.listJobs().map((j) => j.id).sort(), [a, b].sort());
    assert.equal(store.listJobs()[0]?.state, "RECEIVED");
    store.annotate(a, "coach", "NOTE", { n: 1 });
    store.annotate(a, "coach", "NOTE", { n: 2 });
    assert.deepEqual(store.latestArtifact(a, "NOTE"), { n: 2 });
    assert.equal(store.latestArtifact(b, "NOTE"), null);
    assert.equal(store.getJob(a).state, "RECEIVED");
    assert.throws(() => store.annotate(a, "coach", "APPROVED", {}), /checkpoint/);
    assert.throws(() => store.annotate("missing", "coach", "NOTE", {}), /Unknown job/);
  } finally {
    store.close();
  }
});

test("codes belong to a job, expire, resolve case-insensitively and stay out of the audit", () => {
  const store = new Store(":memory:");
  try {
    const id = store.createJob({ original_sha256: "a", original_path: "a.pdf" }, "coach");
    const code = store.issueCode(id, "coach");
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.deepEqual(store.resolveCode(code.toLowerCase()), { job_id: id, issued_by: "coach" });
    assert.equal(store.codeFor(id)?.code, code);
    assert.equal(store.resolveCode("NOPE1234"), null);
    const expired = store.issueCode(id, "coach", 0);
    assert.equal(store.resolveCode(expired), null);
    assert.equal(store.codeFor(id)?.code, code);
    assert.ok(!JSON.stringify(store.history(id)).includes(code));
    assert.throws(() => store.issueCode("missing", "coach"), /Unknown job/);
  } finally {
    store.close();
  }
});
