import type { PipelineState } from "../domain/pipeline-state.js";
import type { Baseline, Store } from "../storage/database.js";
import type { ErrorsCaught } from "../web/reconcile.js";

export type JobMeasurement = {
  job_id: string;
  match_id: string | null;
  state: PipelineState;
  uploaded_at: string | null;
  approved_at: string | null;
  fill_served_at: string | null;
  verified_at: string | null;
  submitted_at: string | null;
  minutes_to_approval: number | null;
  minutes_fill: number | null;
  errors: ErrorsCaught | null;
};
const minutesBetween = (a: string | null, b: string | null) =>
  a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 6000) / 10 : null;

export function jobMeasurements(store: Store, id: string): JobMeasurement {
  const job = store.getJob(id);
  const rows = store.history(id).map((r) => ({ event: String(r.event), at: String(r.at) }));
  const first = (e: string) => rows.find((r) => r.event === e)?.at ?? null;
  const last = (e: string) => rows.findLast((r) => r.event === e)?.at ?? null;
  const d = store.latestArtifact(id, "MATCH_DISCOVERED") as { observed_card?: { match_id?: string } } | null;
  const uploaded_at = first("RECEIVED"),
    approved_at = last("APPROVED"),
    fill_served_at = last("FILL_PLAN_SERVED"),
    verified_at = last("POPULATION_VERIFIED"),
    submitted_at = last("SUBMITTED");
  return {
    job_id: id,
    match_id: d?.observed_card?.match_id ?? null,
    state: job.state,
    uploaded_at,
    approved_at,
    fill_served_at,
    verified_at,
    submitted_at,
    minutes_to_approval: minutesBetween(uploaded_at, approved_at),
    minutes_fill: minutesBetween(fill_served_at, verified_at),
    errors: store.latestArtifact(id, "ERRORS_CAUGHT") as ErrorsCaught | null,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b),
    mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const zero: ErrorsCaught = {
  roster_mismatch: 0,
  status_not_completed: 0,
  winner_first_reorder: 0,
  totals_mismatch: 0,
  score_edited: 0,
  total: 0,
};

export type SeasonReport = {
  jobs: JobMeasurement[];
  matches_uploaded: number;
  matches_approved: number;
  matches_submitted: number;
  errors: ErrorsCaught;
  median_minutes_to_approval: number | null;
  median_minutes_fill: number | null;
  baselines: Baseline[];
  median_baseline_minutes: number | null;
};

export function seasonReport(store: Store): SeasonReport {
  const jobs = store
    .listJobs()
    .map((j) => jobMeasurements(store, j.id))
    .sort((a, b) => (a.uploaded_at ?? "").localeCompare(b.uploaded_at ?? ""));
  const errors = jobs.reduce<ErrorsCaught>(
    (sum, j) =>
      j.errors
        ? {
            roster_mismatch: sum.roster_mismatch + j.errors.roster_mismatch,
            status_not_completed: sum.status_not_completed + j.errors.status_not_completed,
            winner_first_reorder: sum.winner_first_reorder + j.errors.winner_first_reorder,
            totals_mismatch: sum.totals_mismatch + j.errors.totals_mismatch,
            score_edited: sum.score_edited + j.errors.score_edited,
            total: sum.total + j.errors.total,
          }
        : sum,
    zero,
  );
  const baselines = store.listBaselines();
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  return {
    jobs,
    matches_uploaded: jobs.length,
    matches_approved: jobs.filter((j) => j.approved_at !== null).length,
    matches_submitted: jobs.filter((j) => j.state === "SUBMITTED").length,
    errors,
    median_minutes_to_approval: median(nums(jobs.map((j) => j.minutes_to_approval))),
    median_minutes_fill: median(nums(jobs.map((j) => j.minutes_fill))),
    baselines,
    median_baseline_minutes: median(baselines.map((b) => b.minutes)),
  };
}

const num = (n: number | null) => (n === null ? "–" : String(n));

export function renderReport(r: SeasonReport, now: Date): string {
  const lines = [
    `# Score entry: season report (${now.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
    "",
    `Matches uploaded: ${r.matches_uploaded} · approved: ${r.matches_approved} · submitted: ${r.matches_submitted}`,
    "",
    "| Match | State | Upload → approval (min) | Fill → read-back (min) | Errors caught |",
    "|---|---|---|---|---|",
    ...r.jobs.map(
      (j) =>
        `| ${j.match_id ?? "?"} | ${j.state} | ${num(j.minutes_to_approval)} | ${num(j.minutes_fill)} | ${j.errors ? j.errors.total : "–"} |`,
    ),
    "",
    `Errors caught over approved matches: roster ${r.errors.roster_mismatch} · not completed ${r.errors.status_not_completed} · winner-first ${r.errors.winner_first_reorder} · totals ${r.errors.totals_mismatch} · score edits ${r.errors.score_edited} · total ${r.errors.total}`,
    "",
    `Median minutes upload → approval: ${num(r.median_minutes_to_approval)} · fill → read-back: ${num(r.median_minutes_fill)}`,
    "",
    `Median manual entry: ${num(r.median_baseline_minutes)} min (${r.baselines.length} recorded)`,
    "",
    "| Match | Manual minutes | By | Note |",
    "|---|---|---|---|",
    ...r.baselines.map((b) => `| ${b.match_id} | ${b.minutes} | ${b.recorded_by} | ${b.note} |`),
    "",
  ];
  return lines.join("\n");
}
