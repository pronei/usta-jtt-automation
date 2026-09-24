import { test } from "node:test";
import assert from "node:assert/strict";
import { DATE_CONTROL_ID, PREFIX } from "../src/web/context.js";
import { buildFillPlan, compareReadBack } from "../src/web/fill.js";
import { approvedFixture } from "./web-fixtures.js";

const values = (plan: ReturnType<typeof buildFillPlan>) =>
  Object.fromEntries(plan.ops.map((o) => [o.id, o.value]));

test("fill plan maps the approved result onto the form's control ids, winner first", () => {
  const { approved, context, form } = approvedFixture();
  const plan = buildFillPlan(approved, context, form);
  const v = values(plan);
  assert.equal(plan.match_id, "123456");
  assert.equal(v[DATE_CONTROL_ID], "09/13/2026");
  assert.equal(v[`${PREFIX}ctl00_HomeTeam_Player1`], "h1");
  assert.equal(v[`${PREFIX}ctl00_VisitingTeam_Player1`], "a1");
  assert.equal(v[`${PREFIX}ctl00_HomeTeam_Set1`], "3");
  assert.equal(v[`${PREFIX}ctl00_VisitingTeam_Set1`], "1");
  assert.equal(v[`${PREFIX}ctl00_resultId`], "5");
  assert.equal(v[`${PREFIX}ctl00_Winning_TeamId`], "524502");
  assert.equal(v[`${PREFIX}ctl01_HomeTeam_Player2`], "h4");
  assert.equal(v[`${PREFIX}ctl01_VisitingTeam_Player2`], "a3");
  assert.equal(v[`${PREFIX}ctl01_resultId`], "1");
  assert.equal(plan.ops.length, 15);
  assert.ok(plan.ops.every((o) => o.kind === (o.id.endsWith("Set1") || o.id === DATE_CONTROL_ID ? "input" : "select")));
});

test("an away win puts the away games in the first box and the away team as winner", () => {
  const { approved, context, form } = approvedFixture((p) => {
    p.set("l0.home_games", "1");
    p.set("l0.away_games", "3");
  });
  const v = values(buildFillPlan(approved, context, form));
  assert.equal(v[`${PREFIX}ctl00_HomeTeam_Set1`], "3");
  assert.equal(v[`${PREFIX}ctl00_VisitingTeam_Set1`], "1");
  assert.equal(v[`${PREFIX}ctl00_Winning_TeamId`], "526172");
});

test("fill refuses postback selects, a missing date, more sets than boxes and an unknown result label", () => {
  const { approved, context, form } = approvedFixture();
  assert.throws(() => buildFillPlan(approved, context, { ...form, postback_selects: ["x"] }), /postback/);
  assert.throws(() => buildFillPlan(approved, { ...context, date: null }, form), /date/);
  assert.throws(
    () => buildFillPlan(approved, context, { ...form, lines: form.lines.map((l) => ({ ...l, set_boxes: 0 })) }),
    /score box/,
  );
  assert.throws(
    () =>
      buildFillPlan(approved, context, {
        ...form,
        result_options: form.result_options.filter((o) => o.label !== "Timed Match"),
      }),
    /Timed Match/,
  );
});

test("read-back compares every planned field", () => {
  const { approved, context, form } = approvedFixture();
  const plan = buildFillPlan(approved, context, form);
  const fields = values(plan);
  assert.deepEqual(compareReadBack(plan, fields), { ok: true, mismatches: [] });
  const r = compareReadBack(plan, { ...fields, [`${PREFIX}ctl00_HomeTeam_Set1`]: "4" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatches, [{ id: `${PREFIX}ctl00_HomeTeam_Set1`, expected: "3", actual: "4" }]);
  assert.equal(compareReadBack(plan, {}).mismatches.length, plan.ops.length);
});
