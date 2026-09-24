import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage/database.js";

test("the store stamps events with the injected clock and keeps baselines", () => {
  let t = Date.parse("2026-09-13T20:00:00.000Z");
  const store = new Store(":memory:", () => new Date(t));
  try {
    const id = store.createJob({ original_sha256: "a", original_path: "a.pdf" }, "coach");
    t += 60_000;
    store.checkpoint(id, 0, "IMAGE_PREPARED", "coach", {});
    const at = store.history(id).map((r) => String(r.at));
    assert.deepEqual(at, ["2026-09-13T20:00:00.000Z", "2026-09-13T20:01:00.000Z"]);
    store.recordBaseline({ match_id: "123456", minutes: 22.5, recorded_by: "coach", note: "laptop, paper card" });
    assert.deepEqual(store.listBaselines(), [
      { match_id: "123456", minutes: 22.5, recorded_by: "coach", note: "laptop, paper card", at: "2026-09-13T20:01:00.000Z" },
    ]);
    assert.throws(() => store.recordBaseline({ match_id: "x", minutes: 5, recorded_by: "coach", note: "" }));
    assert.throws(() => store.recordBaseline({ match_id: "1", minutes: 0, recorded_by: "coach", note: "" }));
  } finally {
    store.close();
  }
});
