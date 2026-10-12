import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  CapturedFormSchema,
  DATE_CONTROL_ID,
  MATCH_ENTRY_URL,
  PREFIX,
  contextFromForm,
  scoreCardUrl,
} from "../src/web/context.js";
import { el, input, makeDoc, select, table } from "./fake-dom.js";
import { formatRules } from "./web-fixtures.js";

type Jtt = {
  pageKind(loc: { hostname: string; pathname: string; search: string }): string;
  readForm(doc: unknown, loc: unknown): unknown;
  applyOps(doc: unknown, ops: { id: string; kind: string; value: string }[]): string[];
  readFields(doc: unknown, ids: string[]): Record<string, string>;
  scoreCardUrl(matchId: string): string;
  formIsBlank(doc: unknown): boolean;
  hasFinishButton(doc: unknown): boolean;
  ENTRY_URL: string;
};
function load(doc: unknown): Jtt {
  const sandbox: Record<string, unknown> = { document: doc, URLSearchParams, Event: class { constructor(public type: string) {} }, console };
  sandbox.window = sandbox;
  runInNewContext(readFileSync("public/fill.js", "utf8"), sandbox);
  return (sandbox as { __jtt: Jtt }).__jtt;
}
const home: [string, string][] = [["", ""], ["Home Player", "h1"], ["Second Home", "h2"]];
const away: [string, string][] = [["", ""], ["Away Player", "a1"], ["Second Away", "a2"]];
const results: [string, string][] = [["", ""], ["Completed", "1"], ["Retired", "2"], ["Default", "3"], ["Dbl Default", "4"], ["Timed Match", "5"]];
const winners: [string, string][] = [["", ""], ["Momentum Tennis (Team A) - 10U Green", "524502"], ["Away Club - 10U Green", "526172"]];
const line = (ctl: string) => [
  table(`${PREFIX}${ctl}_tblMatch_Ind`, "# 1  Singles - Scoring Format: Short Set (4 Games)"),
  select(`${PREFIX}${ctl}_HomeTeam_Player1`, home),
  select(`${PREFIX}${ctl}_VisitingTeam_Player1`, away),
  input(`${PREFIX}${ctl}_HomeTeam_Set1`),
  input(`${PREFIX}${ctl}_VisitingTeam_Set1`),
  select(`${PREFIX}${ctl}_resultId`, results, "1"),
  select(`${PREFIX}${ctl}_Winning_TeamId`, winners),
];
const bodyText =
  "Match #123456 in 2026 Fall - JTT - Test Momentum Tennis (Team A) - 10U Green [Team ID:5083524502 ] Vs. Away Club - 10U Green [Team ID:5083526172] Date Scheduled: 09/13/2026 2:00 PM Match Win Criteria : Games won";
const location = {
  hostname: "tennislink.usta.com",
  pathname: "/TeamTennis/Secure/MatchScoreCard.aspx",
  search: "?MatchID=123456&MatchTab=M&Preview=No",
  href: "https://tennislink.usta.com/TeamTennis/Secure/MatchScoreCard.aspx?MatchID=123456&MatchTab=M&Preview=No",
};

test("pageKind tells the entry page, the preview page, the refusal page, the rest of TennisLink and other sites apart", () => {
  const jtt = load(makeDoc([], ""));
  assert.equal(jtt.pageKind(location), "entry");
  assert.equal(jtt.pageKind({ ...location, search: "?MatchID=1&Preview=Yes" }), "preview");
  assert.equal(jtt.pageKind({ ...location, pathname: "/TeamTennis/AccessDenied.htm", search: "" }), "denied");
  assert.equal(jtt.pageKind({ ...location, pathname: "/teamtennis/accessdenied.htm", search: "" }), "denied");
  assert.equal(jtt.pageKind({ ...location, pathname: "/Dashboard/Main/" }), "tennislink");
  assert.equal(jtt.pageKind({ ...location, pathname: "/TeamTennis/Secure/EnterMatchNumber.aspx" }), "tennislink");
  assert.equal(jtt.pageKind({ ...location, hostname: "account.usta.com" }), "other");
  assert.equal(jtt.pageKind({ ...location, hostname: "example.org" }), "other");
});

test("the script builds the same TennisLink links as the server", () => {
  const jtt = load(makeDoc([], ""));
  assert.equal(jtt.scoreCardUrl("2743892"), scoreCardUrl("2743892"));
  assert.equal(jtt.ENTRY_URL, MATCH_ENTRY_URL);
});

test("a blank score form and an unpressed Finish button are recognised", () => {
  const jtt = load(makeDoc([], ""));
  assert.equal(jtt.formIsBlank(makeDoc(line("ctl00"), bodyText)), true);
  assert.equal(
    jtt.formIsBlank(makeDoc([...line("ctl00"), input(`${PREFIX}ctl01_HomeTeam_Set1`, "3")], bodyText)),
    false,
  );
  assert.equal(jtt.formIsBlank(makeDoc([], bodyText)), false);
  const finish = el({ id: "ctl00_mainContent_MatchIndividual1_cmdPreviewConfirm", tagName: "INPUT" });
  assert.equal(jtt.hasFinishButton(makeDoc([finish], bodyText)), true);
  assert.equal(jtt.hasFinishButton(makeDoc(line("ctl00"), bodyText)), false);
});

test("readForm captures what contextFromForm needs, and nothing outside the form", () => {
  const doc = makeDoc([input(DATE_CONTROL_ID), ...line("ctl00"), input("unrelated_input", "x")], bodyText);
  const captured = load(doc).readForm(doc, location);
  const parsed = CapturedFormSchema.parse(captured);
  assert.equal(parsed.match_id, "123456");
  assert.ok(parsed.controls.every((c) => c.id.startsWith(PREFIX) || c.id === DATE_CONTROL_ID));
  // The script collapses whitespace; the server's label regex accepts either spacing.
  assert.equal(parsed.labels[0]?.text, "# 1 Singles - Scoring Format: Short Set (4 Games)");
  const { context, form } = contextFromForm(parsed, formatRules);
  assert.equal(context.home_team.team_id, "5083524502");
  assert.deepEqual(context.home_team.roster.map((p) => p.player_id), ["h1", "h2"]);
  assert.equal(form.home_winner_value, "524502");
  assert.equal(context.result_status, "unreported");
});

test("readForm reports onchange handlers so the server can refuse a postback form", () => {
  const withPostback = select(`${PREFIX}ctl00_resultId`, results, "1", "javascript:__doPostBack('x','')");
  const doc = makeDoc([withPostback], bodyText);
  const captured = load(doc).readForm(doc, location) as { controls: { id: string; has_onchange: boolean }[] };
  assert.equal(captured.controls[0]?.has_onchange, true);
});

test("applyOps sets values, fires change events, and reports unknown ids and options", () => {
  const doc = makeDoc([input(DATE_CONTROL_ID), ...line("ctl00")], bodyText);
  const jtt = load(doc);
  const problems = jtt.applyOps(doc, [
    { id: DATE_CONTROL_ID, kind: "input", value: "09/13/2026" },
    { id: `${PREFIX}ctl00_HomeTeam_Player1`, kind: "select", value: "h1" },
    { id: `${PREFIX}ctl00_HomeTeam_Set1`, kind: "input", value: "3" },
    { id: `${PREFIX}ctl00_resultId`, kind: "select", value: "5" },
    { id: `${PREFIX}ctl00_Winning_TeamId`, kind: "select", value: "999999" },
    { id: "missing_id", kind: "input", value: "x" },
  ]);
  // Values built inside the vm sandbox belong to another realm; copy them before a strict deep comparison.
  assert.deepEqual([...problems], [`${PREFIX}ctl00_Winning_TeamId: no option "999999"`, "missing_id: not found"]);
  assert.equal(doc.getElementById(`${PREFIX}ctl00_HomeTeam_Player1`)!.value, "h1");
  assert.deepEqual(doc.getElementById(`${PREFIX}ctl00_HomeTeam_Player1`)!.events, ["input", "change"]);
  assert.equal(doc.getElementById(`${PREFIX}ctl00_Winning_TeamId`)!.value, "");
  assert.deepEqual({ ...jtt.readFields(doc, [DATE_CONTROL_ID, `${PREFIX}ctl00_resultId`, "missing_id"]) }, {
    [DATE_CONTROL_ID]: "09/13/2026",
    [`${PREFIX}ctl00_resultId`]: "5",
  });
});
