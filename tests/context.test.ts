import { test } from "node:test";
import assert from "node:assert/strict";
import { MATCH_ENTRY_URL, PREFIX, contextFromForm, scoreCardUrl } from "../src/web/context.js";
import { AWAY_NAME, HOME_NAME, capturedForm, formatRules } from "./web-fixtures.js";

test("captured form becomes an official context and a form summary", () => {
  const { context, form } = contextFromForm(capturedForm, formatRules);
  assert.equal(context.match_id, "123456");
  assert.equal(context.home_team.team_id, "5083524502");
  assert.equal(context.home_team.team_name, HOME_NAME);
  assert.equal(context.away_team.team_name, AWAY_NAME);
  assert.deepEqual(
    context.home_team.roster.map((p) => p.player_id),
    ["h1", "h2", "h3", "h4"],
  );
  assert.equal(context.date, "09/13/2026");
  assert.deepEqual(
    context.expected_lines.map((l) => [l.position, l.scoring_rule_id, l.players_per_side]),
    [
      ["#1 Singles", "short", 1],
      ["#1 Doubles", "short", 2],
    ],
  );
  assert.equal(context.result_status, "unreported");
  assert.equal(context.source_url, capturedForm.url);
  assert.deepEqual(form.lines, [
    { control: "ctl00", position: "#1 Singles", set_boxes: 1 },
    { control: "ctl01", position: "#1 Doubles", set_boxes: 1 },
  ]);
  assert.equal(form.home_winner_value, "524502");
  assert.equal(form.away_winner_value, "526172");
  assert.equal(form.result_options.find((o) => o.label === "Timed Match")?.value, "5");
  assert.deepEqual(form.postback_selects, []);
});

test("capture is refused for the wrong site, the wrong match, an unmapped format or a missing control", () => {
  assert.throws(
    () => contextFromForm({ ...capturedForm, url: "https://example.org/x?MatchID=123456" }, formatRules),
    /tennislink/,
  );
  assert.throws(
    () => contextFromForm({ ...capturedForm, match_id: "999" }, formatRules),
    /not the requested match/,
  );
  assert.throws(() => contextFromForm(capturedForm, {}), /No scoring rule configured/);
  assert.throws(
    () =>
      contextFromForm(
        {
          ...capturedForm,
          controls: capturedForm.controls.filter((c) => !c.id.endsWith("ctl01_resultId")),
        },
        formatRules,
      ),
    /Form control missing/,
  );
});

test("a form with a score already entered is reported; postback selects are listed", () => {
  const filled = structuredClone(capturedForm);
  filled.controls.find((c) => c.id.endsWith("ctl00_HomeTeam_Set1"))!.value = "4";
  assert.equal(contextFromForm(filled, formatRules).context.result_status, "reported");
  const postback = structuredClone(capturedForm);
  postback.controls.find((c) => c.id.endsWith("ctl00_resultId"))!.has_onchange = true;
  assert.deepEqual(contextFromForm(postback, formatRules).form.postback_selects, [
    `${PREFIX}ctl00_resultId`,
  ]);
});

test("deep links: the match entry page, and one match's Score Card", () => {
  assert.equal(MATCH_ENTRY_URL, "https://tennislink.usta.com/TeamTennis/Secure/EnterMatchNumber.aspx");
  assert.equal(
    scoreCardUrl("2743892"),
    "https://tennislink.usta.com/TeamTennis/Secure/MatchScoreCard.aspx?MatchID=2743892&MatchTab=M&Preview=No",
  );
  assert.throws(() => scoreCardUrl("27a"));
});
