import type { ObservedCard, Observations } from "../src/pipeline/dry-run.js";

export const card: ObservedCard = {
  page: 1,
  match_id: "123456",
  date_text: "09/13/26",
  time_text: "2:00 PM",
  division: "10U Green",
  home_team: "Momentum Tennis - 10U Green",
  away_team: "Away Club - 10U Green",
  location: "Test Park",
  rendered_path: "page-1.png",
  rendered_sha256: "b".repeat(64),
  lines: [
    {
      round: 1,
      position_text: "#1 Singles",
      home_names: ["Home Player"],
      away_names: ["Away Player"],
      home_games: 3,
      away_games: 1,
    },
    {
      round: 1,
      position_text: "#1 Doubles",
      home_names: ["Second Home", "Third Home"],
      away_names: ["Second Away", "Sam Li"],
      home_games: 4,
      away_games: 2,
    },
  ],
  printed_home_total: 7,
  printed_away_total: 3,
};
export const observations: Observations = {
  source_path: "source.pdf",
  source_sha256: "0".repeat(64),
  extraction_method: "test fixture",
  cards: [card],
};
import { DATE_CONTROL_ID, PREFIX, type CapturedForm } from "../src/web/context.js";

export const HOME_NAME = "Momentum Tennis (Team A) - 10U Green";
export const AWAY_NAME = "Away Club - 10U Green";
export const homeRoster = [
  ["h1", "Home Player"],
  ["h2", "Second Home"],
  ["h3", "Ana Ruiz"],
  ["h4", "Third Home"],
];
export const awayRoster = [
  ["a1", "Away Player"],
  ["a2", "Second Away"],
  ["a3", "Sam Li"],
  ["a4", "Sam Liu"],
];
export const resultOptions = [
  ["Completed", "1"],
  ["Retired", "2"],
  ["Default", "3"],
  ["Dbl Default", "4"],
  ["Timed Match", "5"],
].map(([label, value]) => ({ label: label!, value: value! }));
const blank = { label: "", value: "" };
const players = (r: string[][]) => r.map(([value, label]) => ({ label: label!, value: value! }));
const select = (id: string, options: { label: string; value: string }[], value = "") => ({
  id,
  tag: "SELECT" as const,
  type: null,
  value,
  has_onchange: false,
  options: [blank, ...options],
});
const input = (id: string) => ({
  id,
  tag: "INPUT" as const,
  type: "text",
  value: "",
  has_onchange: false,
});
const winnerOptions = [
  { label: HOME_NAME, value: "524502" },
  { label: AWAY_NAME, value: "526172" },
];
function lineControls(control: string, doubles: boolean) {
  const p = (side: "HomeTeam" | "VisitingTeam", n: number) =>
    select(`${PREFIX}${control}_${side}_Player${n}`, players(side === "HomeTeam" ? homeRoster : awayRoster));
  return [
    p("HomeTeam", 1),
    ...(doubles ? [p("HomeTeam", 2)] : []),
    p("VisitingTeam", 1),
    ...(doubles ? [p("VisitingTeam", 2)] : []),
    input(`${PREFIX}${control}_HomeTeam_Set1`),
    input(`${PREFIX}${control}_VisitingTeam_Set1`),
    select(`${PREFIX}${control}_resultId`, resultOptions, "1"),
    select(`${PREFIX}${control}_Winning_TeamId`, winnerOptions),
  ];
}
export const capturedForm: CapturedForm = {
  url: "https://tennislink.usta.com/TeamTennis/Secure/MatchScoreCard.aspx?MatchID=123456&MatchTab=M&Preview=No",
  match_id: "123456",
  captured_at: "2026-09-13T22:00:00.000Z",
  header_text: `Match #123456 in 2026 Fall - JTT - Test ${HOME_NAME} [Team ID:5083524502 ] Vs. ${AWAY_NAME} [Team ID:5083526172] Date Scheduled: 09/13/2026 2:00 PM Match Win Criteria : Games won`,
  labels: [
    { id: `${PREFIX}ctl00_tblMatch_Ind`, text: "# 1  Singles - Scoring Format: Short Set (4 Games)" },
    { id: `${PREFIX}ctl01_tblMatch_Ind`, text: "# 1  Doubles - Scoring Format: Short Set (4 Games)" },
  ],
  controls: [input(DATE_CONTROL_ID), ...lineControls("ctl00", false), ...lineControls("ctl01", true)],
};
export const formatRules = { "Short Set (4 Games)": "short" };
import { Store } from "../src/storage/database.js";
import { validateScoreSheet } from "../src/tennis/score-validator.js";
import { contextFromForm } from "../src/web/context.js";
import { draftFromCard, reviewFromForm, sheetFromReview } from "../src/web/reconcile.js";
import { shortSetRules } from "./fixtures.js";

/** The reviewer's answers for `card` against `capturedForm`: singles timed 3-1, doubles completed 4-2. */
export const reviewParams = () =>
  new URLSearchParams({
    "l0.home.0": "h1",
    "l0.away.0": "a1",
    "l0.home_games": "3",
    "l0.away_games": "1",
    "l0.status": "timed",
    "l0.winner": "",
    "l1.home.0": "h2",
    "l1.home.1": "h4",
    "l1.away.0": "a2",
    "l1.away.1": "a3",
    "l1.home_games": "4",
    "l1.away_games": "2",
    "l1.status": "completed",
    "l1.winner": "",
  });

/** Runs the fixtures through reconcile, validation and approval in a throwaway store. */
export function approvedFixture(edit?: (params: URLSearchParams) => void) {
  const { context, form } = contextFromForm(capturedForm, formatRules);
  const draft = draftFromCard(card, context, shortSetRules);
  const params = reviewParams();
  edit?.(params);
  const sheet = sheetFromReview(reviewFromForm(params, draft), draft, card, context);
  const result = validateScoreSheet(sheet, context, shortSetRules);
  if (!result.valid) throw new Error(JSON.stringify(result.issues));
  const store = new Store(":memory:");
  try {
    const id = store.createJob({ original_sha256: "x", original_path: "x.pdf" }, "coach");
    for (const s of [
      "IMAGE_PREPARED",
      "MATCH_DISCOVERED",
      "TENNISLINK_MATCH_FOUND",
      "OFFICIAL_CONTEXT_CAPTURED",
      "SCORE_SHEET_INTERPRETED",
      "VALIDATING",
      "VALIDATED",
    ] as const)
      store.checkpoint(id, store.getJob(id).revision, s, "coach", s === "VALIDATED" ? result.value : { stage: s });
    const approved = store.approve(id, store.getJob(id).revision, result.value, "coach");
    return { approved, context, form, sheet, draft };
  } finally {
    store.close();
  }
}
