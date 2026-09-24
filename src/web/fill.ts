import type { ApprovedMatch, OfficialMatchContext, ResultStatus } from "../domain/schemas.js";
import type { FormSummary } from "./context.js";

export const STATUS_LABEL: Record<ResultStatus, string> = {
  completed: "Completed",
  timed: "Timed Match",
  retired: "Retired",
  default: "Default",
  double_default: "Dbl Default",
};
export type FillOp = { id: string; kind: "select" | "input"; value: string };
export type FillPlan = { match_id: string; ops: FillOp[]; note: string };

export function buildFillPlan(
  approved: ApprovedMatch,
  context: OfficialMatchContext,
  form: FormSummary,
): FillPlan {
  const payload = approved.validation.payload;
  if (form.postback_selects.length)
    throw new Error(
      `The form's selects trigger postbacks; filling is not supported on this page version (${form.postback_selects.join(", ")})`,
    );
  if (context.date === null)
    throw new Error("No scheduled date was captured; the form needs a date played");
  const ops: FillOp[] = [{ id: form.date_control_id, kind: "input", value: context.date }];
  for (const line of payload.lines) {
    const f = form.lines.find((l) => l.position === line.position);
    if (!f) throw new Error(`Line ${line.position} is not on the form`);
    if (line.sets.length > f.set_boxes)
      throw new Error(
        `Line ${line.position}: the form has ${f.set_boxes} score box pair(s), the result has ${line.sets.length} sets`,
      );
    const id = (suffix: string) => `${form.prefix}${f.control}_${suffix}`;
    line.home_player_ids.forEach((value, i) =>
      ops.push({ id: id(`HomeTeam_Player${i + 1}`), kind: "select", value }),
    );
    line.away_player_ids.forEach((value, i) =>
      ops.push({ id: id(`VisitingTeam_Player${i + 1}`), kind: "select", value }),
    );
    for (let n = 1; n <= f.set_boxes; n++) {
      const set = line.sets[n - 1];
      // Standing operator rule: the first box is the line winner's games, the second the other side's.
      const first = set ? (line.winner === "away" ? set.away : set.home) : null;
      const second = set ? (line.winner === "away" ? set.home : set.away) : null;
      ops.push({ id: id(`HomeTeam_Set${n}`), kind: "input", value: first === null ? "" : String(first) });
      ops.push({ id: id(`VisitingTeam_Set${n}`), kind: "input", value: second === null ? "" : String(second) });
    }
    const label = STATUS_LABEL[line.status];
    const result = form.result_options.find((o) => o.label === label);
    if (!result) throw new Error(`The form offers no "${label}" result`);
    ops.push({ id: id("resultId"), kind: "select", value: result.value });
    ops.push({
      id: id("Winning_TeamId"),
      kind: "select",
      value:
        line.winner === "home"
          ? form.home_winner_value
          : line.winner === "away"
            ? form.away_winner_value
            : "",
    });
  }
  return {
    match_id: payload.match_id,
    ops,
    note: "Check every field, press Next, review the preview, press Finish. Then tap the bookmark again on the page that follows.",
  };
}

export function compareReadBack(
  plan: FillPlan,
  fields: Record<string, string>,
): { ok: boolean; mismatches: { id: string; expected: string; actual: string }[] } {
  const mismatches = plan.ops.flatMap((op) => {
    const actual = fields[op.id];
    return actual !== undefined && actual.trim() === op.value.trim()
      ? []
      : [{ id: op.id, expected: op.value, actual: actual ?? "(missing)" }];
  });
  return { ok: mismatches.length === 0, mismatches };
}
