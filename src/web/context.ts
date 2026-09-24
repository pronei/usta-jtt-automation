import { z } from "zod";
import {
  MatchIdSchema,
  OfficialMatchContextSchema,
  type OfficialMatchContext,
} from "../domain/schemas.js";

export const PREFIX = "ctl00_mainContent_MatchIndividual1_Match_Ind_";
export const DATE_CONTROL_ID = "ctl00_mainContent_MatchIndividual1_MatchActualDate";
const LINE_LABEL = /^#\s*(\d+)\s+(Singles|Doubles)\s*-\s*Scoring Format:\s*(.+?)\s*$/;
const option = z.strictObject({ label: z.string(), value: z.string() });
export const CapturedControlSchema = z.strictObject({
  id: z.string().min(1),
  tag: z.enum(["SELECT", "INPUT"]),
  type: z.string().nullable(),
  value: z.string(),
  has_onchange: z.boolean(),
  options: z.array(option).optional(),
});
export const CapturedFormSchema = z.strictObject({
  url: z.url(),
  match_id: MatchIdSchema,
  captured_at: z.iso.datetime(),
  header_text: z.string().min(1),
  labels: z.array(z.strictObject({ id: z.string().min(1), text: z.string() })),
  controls: z.array(CapturedControlSchema).min(1),
});
export type CapturedForm = z.infer<typeof CapturedFormSchema>;
export const FormatRulesSchema = z.record(z.string().min(1), z.string().min(1));
export const FormSummarySchema = z.strictObject({
  prefix: z.literal(PREFIX),
  date_control_id: z.literal(DATE_CONTROL_ID),
  lines: z
    .array(
      z.strictObject({
        control: z.string().min(1),
        position: z.string().min(1),
        set_boxes: z.number().int().min(1),
      }),
    )
    .min(1),
  result_options: z.array(option).min(1),
  home_winner_value: z.string().min(1),
  away_winner_value: z.string().min(1),
  postback_selects: z.array(z.string()),
});
export type FormSummary = z.infer<typeof FormSummarySchema>;

export function contextFromForm(
  raw: unknown,
  formatRulesRaw: unknown,
): { context: OfficialMatchContext; form: FormSummary } {
  const form = CapturedFormSchema.parse(raw),
    formatRules = FormatRulesSchema.parse(formatRulesRaw);
  const url = new URL(form.url);
  if (url.protocol !== "https:" || url.hostname !== "tennislink.usta.com")
    throw new Error("Capture did not come from tennislink.usta.com");
  if (url.searchParams.get("MatchID") !== form.match_id)
    throw new Error("Captured page is not the requested match");
  const byId = new Map(form.controls.map((c) => [c.id, c]));
  const control = (id: string) => {
    const c = byId.get(id);
    if (!c) throw new Error(`Form control missing: ${id}`);
    return c;
  };
  const options = (id: string) => (control(id).options ?? []).filter((o) => o.value !== "");
  const text = form.header_text.replace(/\s+/g, " ");
  const teamIds = [...text.matchAll(/\[Team ID:\s*(\d+)\s*\]/g)].map((m) => m[1]!);
  if (teamIds.length !== 2) throw new Error("Expected two team IDs in the page header");
  const lineIdPattern = new RegExp(`^${PREFIX}(ctl\\d+)_tblMatch_Ind$`);
  const lines = form.labels.flatMap((l) => {
    const m = lineIdPattern.exec(l.id);
    if (!m) return [];
    const label = LINE_LABEL.exec(l.text.replace(/\s+/g, " ").trim());
    if (!label) throw new Error(`Unrecognised line label: ${l.text}`);
    const ctl = m[1]!,
      type = label[2]!.toLowerCase() as "singles" | "doubles",
      format = label[3]!,
      rule = formatRules[format];
    if (!rule) throw new Error(`No scoring rule configured for format "${format}"`);
    for (const side of ["HomeTeam", "VisitingTeam"]) {
      control(`${PREFIX}${ctl}_${side}_Player1`);
      if (type === "doubles") control(`${PREFIX}${ctl}_${side}_Player2`);
      control(`${PREFIX}${ctl}_${side}_Set1`);
    }
    control(`${PREFIX}${ctl}_resultId`);
    control(`${PREFIX}${ctl}_Winning_TeamId`);
    const boxes = new RegExp(`^${PREFIX}${ctl}_HomeTeam_Set\\d+$`);
    return [
      {
        control: ctl,
        position: `#${label[1]} ${label[2]}`,
        type,
        rule,
        set_boxes: form.controls.filter((c) => boxes.test(c.id)).length,
      },
    ];
  });
  if (!lines.length) throw new Error("No score lines found on the page");
  const first = lines[0]!.control;
  const winnerOptions = options(`${PREFIX}${first}_Winning_TeamId`);
  const team = (teamId: string) => {
    const match = winnerOptions.find((o) => text.includes(`${o.label} [Team ID:${teamId}`));
    if (!match) throw new Error(`Could not match a team name to team ID ${teamId}`);
    return { team_id: teamId, team_name: match.label, winner_value: match.value };
  };
  const home = team(teamIds[0]!),
    away = team(teamIds[1]!);
  const roster = (side: "HomeTeam" | "VisitingTeam") =>
    options(`${PREFIX}${first}_${side}_Player1`).map((o) => ({
      player_id: o.value,
      display_name: o.label,
    }));
  const date = /Date Scheduled:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1] ?? null;
  const scoreOrPlayer = /_(HomeTeam|VisitingTeam)_(Player|Set)\d+$/;
  const unreported = form.controls
    .filter((c) => c.id.startsWith(PREFIX) && scoreOrPlayer.test(c.id))
    .every((c) => c.value === "");
  const context = OfficialMatchContextSchema.parse({
    match_id: form.match_id,
    date,
    home_team: { team_id: home.team_id, team_name: home.team_name, roster: roster("HomeTeam") },
    away_team: {
      team_id: away.team_id,
      team_name: away.team_name,
      roster: roster("VisitingTeam"),
    },
    expected_lines: lines.map((l) => ({
      position: l.position,
      type: l.type,
      players_per_side: l.type === "singles" ? 1 : 2,
      scoring_rule_id: l.rule,
    })),
    captured_at: form.captured_at,
    source_url: form.url,
    result_status: unreported ? "unreported" : "reported",
  });
  const summary = FormSummarySchema.parse({
    prefix: PREFIX,
    date_control_id: DATE_CONTROL_ID,
    lines: lines.map((l) => ({ control: l.control, position: l.position, set_boxes: l.set_boxes })),
    result_options: options(`${PREFIX}${first}_resultId`),
    home_winner_value: home.winner_value,
    away_winner_value: away.winner_value,
    postback_selects: form.controls
      .filter((c) => c.tag === "SELECT" && c.has_onchange)
      .map((c) => c.id),
  });
  return { context, form: summary };
}
