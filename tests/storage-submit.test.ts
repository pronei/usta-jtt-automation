import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/database.js";
import { validateScoreSheet } from "../src/tennis/score-validator.js";
import { submitMatch } from "../src/tennislink/submit-match.js";
import { populateScores } from "../src/tennislink/populate-scores.js";
import type { TennisLinkWritePort } from "../src/tennislink/write-port.js";
import { context, rules, sheet } from "./fixtures.js";
function prepare(store: Store, input = sheet) {
  const id = store.createJob(
    { original_sha256: "test-hash", original_path: "private/image.png" },
    "operator",
  );
  const result = validateScoreSheet(input, context, rules);
  if (!result.valid) throw new Error("Bad fixture");
  for (const state of [
    "IMAGE_PREPARED",
    "MATCH_DISCOVERED",
    "TENNISLINK_MATCH_FOUND",
    "OFFICIAL_CONTEXT_CAPTURED",
    "SCORE_SHEET_INTERPRETED",
    "VALIDATING",
    "VALIDATED",
  ] as const)
    store.checkpoint(
      id,
      store.getJob(id).revision,
      state,
      "operator",
      state === "VALIDATED" ? result.value : { stage: state },
    );
  const approval = store.approve(
    id,
    store.getJob(id).revision,
    result.value,
    "coach",
  );
  return { id, approval };
}
function portFor(approval: ReturnType<typeof prepare>["approval"]) {
  let submits = 0;
  const port: TennisLinkWritePort = {
    readCurrentContext: async () => structuredClone(context),
    populate: async () => {},
    readBack: async () => structuredClone(approval.validation.payload),
    submit: async () => {
      submits++;
      return {
        match_id: context.match_id,
        receipt: "official-confirmation-123",
      };
    },
  };
  return { port, count: () => submits };
}
test("checkpoint survives reopen and rejects stale writers", () => {
  const dir = mkdtempSync(join(tmpdir(), "momentum-"));
  try {
    const file = join(dir, "state.sqlite");
    let store = new Store(file);
    const id = store.createJob(
      { original_sha256: "h", original_path: "p" },
      "coach",
    );
    store.checkpoint(id, 0, "IMAGE_PREPARED", "coach", { prepared: "hash" });
    store.close();
    store = new Store(file);
    assert.equal(store.getJob(id).state, "IMAGE_PREPARED");
    assert.equal(store.history(id).length, 2);
    assert.throws(() =>
      store.checkpoint(id, 0, "MATCH_DISCOVERED", "coach", {}),
    );
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("approval cannot be forged or mutated; direct state shortcut rejected", () => {
  const store = new Store(":memory:");
  try {
    const { id, approval } = prepare(store);
    assert.throws(() =>
      store.assertApproval(id, { ...approval, approved_by: "someone else" }),
    );
    assert.throws(() =>
      store.checkpoint(
        id,
        store.getJob(id).revision,
        "SUBMITTING",
        "coach",
        {},
      ),
    );
  } finally {
    store.close();
  }
});
test("disabled flag makes zero submission calls; successful submit blocks another job for same match", async () => {
  const store = new Store(":memory:");
  try {
    const { id, approval } = prepare(store),
      p = portFor(approval);
    await populateScores(store, id, approval, p.port, context);
    const args = {
      store,
      jobId: id,
      approval,
      originalContext: context,
      port: p.port,
      enabled: false,
      confirmedApprovalId: approval.approval_id,
    };
    await assert.rejects(submitMatch(args), /disabled/);
    assert.equal(p.count(), 0);
    await submitMatch({ ...args, enabled: true });
    assert.equal(store.getJob(id).state, "SUBMITTED");
    assert.equal(p.count(), 1);
    const second = prepare(store),
      p2 = portFor(second.approval);
    await populateScores(store, second.id, second.approval, p2.port, context);
    await assert.rejects(
      submitMatch({
        ...args,
        jobId: second.id,
        approval: second.approval,
        port: p2.port,
        enabled: true,
        confirmedApprovalId: second.approval.approval_id,
      }),
      /UNIQUE/,
    );
    assert.equal(p2.count(), 0);
  } finally {
    store.close();
  }
});
test("uncertain submit is durable and never automatically retried", async () => {
  const store = new Store(":memory:");
  try {
    const { id, approval } = prepare(store),
      p = portFor(approval);
    await populateScores(store, id, approval, p.port, context);
    p.port.submit = async () => {
      throw new Error("Connection dropped after click");
    };
    const args = {
      store,
      jobId: id,
      approval,
      originalContext: context,
      port: p.port,
      enabled: true,
      confirmedApprovalId: approval.approval_id,
    };
    await assert.rejects(submitMatch(args), /Connection dropped/);
    assert.equal(store.getJob(id).state, "SUBMISSION_UNKNOWN");
    await assert.rejects(submitMatch(args), /not been verified/);
  } finally {
    store.close();
  }
});
test("read-back mismatch and roster drift block final submit", async () => {
  const store = new Store(":memory:");
  try {
    const { id, approval } = prepare(store),
      p = portFor(approval);
    await populateScores(store, id, approval, p.port, context);
    const args = {
      store,
      jobId: id,
      approval,
      originalContext: context,
      port: p.port,
      enabled: true,
      confirmedApprovalId: approval.approval_id,
    };
    p.port.readBack = async () => ({
      ...approval.validation.payload,
      match_id: "999",
    });
    await assert.rejects(submitMatch(args), /Read-back/);
    p.port.readBack = async () => approval.validation.payload;
    p.port.readCurrentContext = async () => ({
      ...context,
      home_team: { ...context.home_team, team_name: "Changed" },
    });
    await assert.rejects(submitMatch(args), /context changed/);
    assert.equal(p.count(), 0);
  } finally {
    store.close();
  }
});

test("match reservation also blocks different scores from another job", async () => {
  const store = new Store(":memory:");
  try {
    const first = prepare(store),
      p = portFor(first.approval);
    await populateScores(store, first.id, first.approval, p.port, context);
    store.reserveSubmission(
      first.id,
      store.getJob(first.id).revision,
      first.approval,
    );
    const changed = structuredClone(sheet);
    changed.lines[0]!.sets[0]!.away = 2;
    const second = prepare(store, changed);
    assert.notDeepEqual(
      first.approval.validation.payload,
      second.approval.validation.payload,
    );
    // The match-level constraint applies independently of payload fingerprint.
    store.checkpoint(
      second.id,
      store.getJob(second.id).revision,
      "POPULATING_TENNISLINK",
      "coach",
      {},
    );
    store.checkpoint(
      second.id,
      store.getJob(second.id).revision,
      "POPULATION_VERIFIED",
      "coach",
      {},
    );
    assert.throws(
      () =>
        store.reserveSubmission(
          second.id,
          store.getJob(second.id).revision,
          second.approval,
        ),
      /UNIQUE/,
    );
    assert.equal(store.getJob(second.id).state, "POPULATION_VERIFIED");
  } finally {
    store.close();
  }
});
