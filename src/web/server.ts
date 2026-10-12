import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { fingerprint } from "../domain/fingerprint.js";
import { renderReport, seasonReport } from "../measure/report.js";
import type { PipelineState } from "../domain/pipeline-state.js";
import {
  ApprovedMatchSchema,
  InterpretedScoreSheetSchema,
  OfficialMatchContextSchema,
  ValidatedMatchSchema,
  ValidationIssueSchema,
} from "../domain/schemas.js";
import { ObservedCardSchema } from "../pipeline/dry-run.js";
import type { Store } from "../storage/database.js";
import { validateScoreSheet } from "../tennis/score-validator.js";
import type { ScoringRule } from "../tennis/scoring-rules.js";
import { parseCookies, reviewerForToken, signSession, verifySession, type Reviewers } from "./auth.js";
import { FormSummarySchema, TENNISLINK_ORIGIN, contextFromForm } from "./context.js";
import { buildFillPlan, compareReadBack, type FillPlan } from "./fill.js";
import { page, type Html } from "./html.js";
import {
  ReviewSchema,
  draftFromCard,
  errorsCaught,
  orientCard,
  reviewFromForm,
  sheetFromReview,
} from "./reconcile.js";
import { ingestExport } from "./import.js";
import { ingestPdf, type Extractor } from "./upload.js";
import {
  bookmarkletView,
  errorView,
  jobView,
  listView,
  loginView,
  reportView,
  type JobModel,
  type JobRow,
} from "./views.js";

export type AppDeps = {
  store: Store;
  reviewers: Reviewers;
  sessionSecret: string;
  publicUrl: string;
  uploadDir: string;
  extractor: Extractor;
  scoringRules: ScoringRule[];
  formatRules: Record<string, string>;
  fillScript: string;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const MAX_BODY = 20 * 1024 * 1024;
const CORS = {
  "access-control-allow-origin": TENNISLINK_ORIGIN,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  vary: "origin",
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}
const json = (res: ServerResponse, status: number, body: unknown, headers = {}) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), headers);
const redirect = (res: ServerResponse, to: string, headers: Record<string, string> = {}) => {
  res.writeHead(303, { location: to, "cache-control": "no-store", ...headers });
  res.end();
};
const errorText = (e: unknown) =>
  e instanceof z.ZodError
    ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    : e instanceof Error
      ? e.message
      : String(e);
const statusOf = (e: unknown) =>
  e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500;

export function jobRows(deps: AppDeps): JobRow[] {
  return deps.store.listJobs().map((j) => {
    const d = deps.store.latestArtifact(j.id, "MATCH_DISCOVERED") as {
      observed_card?: { match_id: string; home_team: string; away_team: string };
    } | null;
    return {
      id: j.id,
      state: j.state,
      created_at: j.created_at,
      match_id: d?.observed_card?.match_id ?? null,
      home_team: d?.observed_card?.home_team ?? null,
      away_team: d?.observed_card?.away_team ?? null,
      code: deps.store.codeFor(j.id)?.code ?? null,
    };
  });
}

const AFTER_APPROVAL: PipelineState[] = [
  "APPROVED",
  "POPULATING_TENNISLINK",
  "POPULATION_VERIFIED",
  "SUBMITTING",
  "SUBMISSION_UNKNOWN",
  "SUBMITTED",
];

export function jobModel(deps: AppDeps, id: string): JobModel {
  const store = deps.store,
    job = store.getJob(id);
  const discovered = store.latestArtifact(id, "MATCH_DISCOVERED") as { observed_card: unknown } | null;
  const swapped =
    (store.latestArtifact(id, "ORIENTATION") as { swapped: boolean } | null)?.swapped ?? false;
  const card = discovered ? orientCard(ObservedCardSchema.parse(discovered.observed_card), swapped) : null;
  const captured = store.latestArtifact(id, "OFFICIAL_CONTEXT_CAPTURED") as {
    context: unknown;
    form: unknown;
  } | null;
  const context = captured ? OfficialMatchContextSchema.parse(captured.context) : null;
  const draft = card && context ? draftFromCard(card, context, deps.scoringRules) : null;
  const validating = store.latestArtifact(id, "VALIDATING") as { review?: unknown } | null;
  const review = validating?.review ? ReviewSchema.parse(validating.review) : null;
  const needs =
    job.state === "NEEDS_REVIEW"
      ? (store.latestArtifact(id, "NEEDS_REVIEW") as { issues?: unknown; mismatches?: unknown } | null)
      : null;
  const issues = needs?.issues ? z.array(ValidationIssueSchema).parse(needs.issues) : [];
  const mismatches = needs?.mismatches
    ? z.array(z.object({ id: z.string(), expected: z.string(), actual: z.string() })).parse(needs.mismatches)
    : null;
  const approvedRaw = store.latestArtifact(id, "APPROVED");
  const approval =
    approvedRaw && AFTER_APPROVAL.includes(job.state) ? ApprovedMatchSchema.parse(approvedRaw) : null;
  const errors = approval ? (store.latestArtifact(id, "ERRORS_CAUGHT") as JobModel["errors"]) : null;
  const receipt =
    job.state === "SUBMITTED"
      ? ((store.latestArtifact(id, "SUBMITTED") as { receipt?: string } | null)?.receipt ?? null)
      : null;
  return {
    job,
    code: store.codeFor(id),
    card,
    swapped,
    context,
    draft,
    review,
    issues: issues.length ? issues : null,
    mismatches,
    approval,
    errors,
    receipt,
  };
}

function fillPlan(deps: AppDeps, id: string): FillPlan {
  const store = deps.store;
  const approved = ApprovedMatchSchema.parse(store.latestArtifact(id, "APPROVED"));
  const captured = store.latestArtifact(id, "OFFICIAL_CONTEXT_CAPTURED") as {
    context: unknown;
    form: unknown;
  };
  const context = OfficialMatchContextSchema.parse(captured.context);
  if (context.result_status !== "unreported")
    throw new HttpError(409, "TennisLink already shows scores for this match");
  if (fingerprint(context) !== approved.validation.context_hash)
    throw new HttpError(409, "The approval does not match the captured form");
  return buildFillPlan(approved, context, FormSummarySchema.parse(captured.form));
}

const CodeSchema = z.object({ code: z.string().min(1) });
const stageOf = (state: PipelineState) =>
  state === "MATCH_DISCOVERED"
    ? "capture"
    : state === "APPROVED"
      ? "fill"
      : state === "SUBMITTING"
        ? "confirm"
        : state === "SUBMITTED"
          ? "done"
          : "wait";

async function api(
  deps: AppDeps,
  method: string,
  path: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const store = deps.store;
  const body =
    method === "POST"
      ? z.record(z.string(), z.unknown()).parse(JSON.parse((await readBody(req)).toString() || "{}"))
      : {};
  const authorise = (jobId: string | null, code: unknown) => {
    const resolved = store.resolveCode(CodeSchema.parse({ code }).code);
    if (!resolved || (jobId !== null && resolved.job_id !== jobId))
      throw new HttpError(404, "Unknown or expired code");
    return resolved;
  };
  if (path === "/api/handshake" && method === "POST") {
    const { job_id } = authorise(null, body.code);
    const job = store.getJob(job_id);
    const d = store.latestArtifact(job_id, "MATCH_DISCOVERED") as {
      observed_card?: { match_id?: string };
    } | null;
    return json(
      res,
      200,
      { job_id, match_id: d?.observed_card?.match_id ?? null, stage: stageOf(job.state), state: job.state },
      CORS,
    );
  }
  const m = /^\/api\/jobs\/([0-9a-f-]{36})\/(context|fill|readback|receipt)$/.exec(path);
  if (!m) throw new HttpError(404, "No such endpoint");
  const id = m[1]!,
    action = m[2]!;
  const { issued_by } = authorise(id, method === "GET" ? url.searchParams.get("code") : body.code);
  const actor = `bookmarklet:${issued_by}`;
  const job = store.getJob(id);
  const rev = () => store.getJob(id).revision;
  if (action === "context" && method === "POST") {
    if (job.state !== "MATCH_DISCOVERED")
      throw new HttpError(409, `Capture is not expected in state ${job.state}`);
    const { context, form } = contextFromForm(body.captured, deps.formatRules);
    const d = store.latestArtifact(id, "MATCH_DISCOVERED") as { observed_card: { match_id: string } };
    if (context.match_id !== d.observed_card.match_id)
      throw new HttpError(409, "This page is a different match from the uploaded card");
    store.checkpoint(id, rev(), "TENNISLINK_MATCH_FOUND", actor, {
      url: context.source_url,
      captured_at: context.captured_at,
      captured: body.captured,
    });
    store.checkpoint(id, rev(), "OFFICIAL_CONTEXT_CAPTURED", actor, { context, form });
    return json(res, 200, { ok: true, result_status: context.result_status }, CORS);
  }
  if (action === "fill" && method === "GET") {
    if (job.state !== "APPROVED") throw new HttpError(409, `Fill is not expected in state ${job.state}`);
    const plan = fillPlan(deps, id);
    store.annotate(id, actor, "FILL_PLAN_SERVED", { ops: plan.ops.length });
    return json(res, 200, plan, CORS);
  }
  if (action === "readback" && method === "POST") {
    if (job.state !== "APPROVED")
      throw new HttpError(409, `Read-back is not expected in state ${job.state}`);
    const plan = fillPlan(deps, id);
    const fields = z.record(z.string(), z.string()).parse(body.fields);
    const approved = ApprovedMatchSchema.parse(store.latestArtifact(id, "APPROVED"));
    store.checkpoint(id, rev(), "POPULATING_TENNISLINK", actor, { approval_id: approved.approval_id });
    const result = compareReadBack(plan, fields);
    if (!result.ok) {
      store.checkpoint(id, rev(), "NEEDS_REVIEW", actor, { issues: [], mismatches: result.mismatches });
      return json(res, 200, result, CORS);
    }
    store.checkpoint(id, rev(), "POPULATION_VERIFIED", actor, { read_back: fields });
    try {
      store.reserveSubmission(id, rev(), approved);
    } catch (e) {
      throw new HttpError(
        409,
        /UNIQUE/.test(String(e)) ? "Another job already holds the submission for this match" : errorText(e),
      );
    }
    return json(res, 200, { ok: true, mismatches: [], note: plan.note }, CORS);
  }
  if (action === "receipt" && method === "POST") {
    if (job.state !== "SUBMITTING")
      throw new HttpError(409, `A receipt is not expected in state ${job.state}`);
    const r = z.object({ url: z.url(), page_text: z.string().min(1).max(4000) }).parse(body);
    if (new URL(r.url).origin !== TENNISLINK_ORIGIN)
      throw new HttpError(400, "Receipt must come from TennisLink");
    store.completeSubmission(id, `${r.url}\n${r.page_text}`, actor);
    return json(res, 200, { ok: true }, CORS);
  }
  throw new HttpError(405, "Method not allowed");
}

async function pages(
  deps: AppDeps,
  reviewer: string,
  method: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const store = deps.store;
  const render = (title: string, body: Html) =>
    send(res, 200, "text/html; charset=utf-8", page(title, body));
  if (path === "/" && method === "GET") return render("Matches", listView(jobRows(deps)));
  if (path === "/bookmarklet" && method === "GET")
    return render("Bookmark", bookmarkletView(deps.publicUrl));
  if (path === "/report" && method === "GET")
    return render("Season report", reportView(renderReport(seasonReport(store), new Date())));
  if (path === "/baselines" && method === "POST") {
    const form = new URLSearchParams((await readBody(req)).toString());
    store.recordBaseline({
      match_id: form.get("match_id") ?? "",
      minutes: Number(form.get("minutes")),
      recorded_by: reviewer,
      note: form.get("note") ?? "",
    });
    return redirect(res, "/report");
  }
  if (path === "/upload" && method === "POST") {
    const type = req.headers["content-type"] ?? "";
    if (!type.startsWith("multipart/form-data")) throw new HttpError(400, "Expected a multipart upload");
    const form = await new Response(Uint8Array.from(await readBody(req)), {
      headers: { "content-type": type },
    }).formData();
    const file = form.get("pdf");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() === "%PDF-")
      await ingestPdf(store, deps.extractor, deps.uploadDir, bytes, reviewer);
    else if (bytes.toString("utf8", 0, 64).trimStart().startsWith("{"))
      await ingestExport(store, deps.uploadDir, bytes, reviewer);
    else throw new HttpError(400, "Choose a scorecard PDF or a scorecard export (JSON)");
    return redirect(res, "/");
  }
  const m = /^\/jobs\/([0-9a-f-]{36})(?:\/([a-z]+))?$/.exec(path);
  if (!m) throw new HttpError(404, "No such page");
  const id = m[1]!,
    action = m[2];
  if (!action && method === "GET") return render("Match", jobView(jobModel(deps, id)));
  if (method !== "POST") throw new HttpError(405, "Use POST");
  const job = store.getJob(id);
  const rev = () => store.getJob(id).revision;
  switch (action) {
    case "code":
      store.issueCode(id, reviewer);
      break;
    case "orientation": {
      if (!["MATCH_DISCOVERED", "OFFICIAL_CONTEXT_CAPTURED", "NEEDS_REVIEW"].includes(job.state))
        throw new HttpError(409, "Sides can only be swapped before validation; reopen first");
      const current =
        (store.latestArtifact(id, "ORIENTATION") as { swapped: boolean } | null)?.swapped ?? false;
      store.annotate(id, reviewer, "ORIENTATION", { swapped: !current });
      break;
    }
    case "reconcile": {
      const model = jobModel(deps, id);
      if (!model.draft || !model.context || !model.card)
        throw new HttpError(409, "The form has not been captured yet");
      const params = new URLSearchParams((await readBody(req)).toString());
      const review = reviewFromForm(params, model.draft);
      const sheet = sheetFromReview(review, model.draft, model.card, model.context);
      if (job.state === "OFFICIAL_CONTEXT_CAPTURED")
        store.checkpoint(id, rev(), "SCORE_SHEET_INTERPRETED", reviewer, { sheet });
      else if (job.state !== "NEEDS_REVIEW") throw new HttpError(409, `Cannot validate from ${job.state}`);
      store.checkpoint(id, rev(), "VALIDATING", reviewer, { sheet, review });
      const result = validateScoreSheet(sheet, model.context, deps.scoringRules);
      if (result.valid) store.checkpoint(id, rev(), "VALIDATED", reviewer, result.value);
      else store.checkpoint(id, rev(), "NEEDS_REVIEW", reviewer, { issues: result.issues });
      break;
    }
    case "reopen":
      if (job.state !== "VALIDATED") throw new HttpError(409, "Only a validated match can be reopened");
      store.checkpoint(id, rev(), "NEEDS_REVIEW", reviewer, { issues: [], reason: "reopened by reviewer" });
      break;
    case "approve": {
      if (job.state !== "VALIDATED") throw new HttpError(409, "Validate first");
      const model = jobModel(deps, id);
      const validated = ValidatedMatchSchema.parse(store.latestArtifact(id, "VALIDATED"));
      const approved = store.approve(id, rev(), validated, reviewer);
      const validating = store.latestArtifact(id, "VALIDATING") as { sheet: unknown } | null;
      if (validating && model.draft && model.card)
        store.annotate(
          id,
          reviewer,
          "ERRORS_CAUGHT",
          errorsCaught(
            model.draft,
            model.card,
            InterpretedScoreSheetSchema.parse(validating.sheet),
            approved.validation.payload,
          ),
        );
      break;
    }
    case "unknown":
      if (job.state !== "SUBMITTING")
        throw new HttpError(409, "Only a submitting match can be marked unknown");
      store.markSubmissionUnknown(id, reviewer);
      break;
    default:
      throw new HttpError(404, "No such action");
  }
  return redirect(res, `/jobs/${id}`);
}

async function handle(deps: AppDeps, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET",
    path = url.pathname;
  if (path.startsWith("/api/")) {
    if (method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    try {
      await api(deps, method, path, url, req, res);
    } catch (e) {
      const status = statusOf(e);
      if (status === 500) console.error(e);
      json(res, status, { error: status === 500 ? "Internal error" : errorText(e) }, CORS);
    }
    return;
  }
  if (path === "/fill.js") return send(res, 200, "text/javascript; charset=utf-8", deps.fillScript);
  if (path === "/login") {
    if (method === "GET")
      return send(res, 200, "text/html; charset=utf-8", page("Sign in", loginView(url.searchParams.get("error"))));
    if (method === "POST") {
      const form = new URLSearchParams((await readBody(req)).toString());
      const name = reviewerForToken(deps.reviewers, form.get("token") ?? "");
      if (!name) return redirect(res, "/login?error=Unknown+token");
      const secure = deps.publicUrl.startsWith("https:") ? "; Secure" : "";
      return redirect(res, "/", {
        "set-cookie": `reviewer=${signSession(deps.sessionSecret, name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
      });
    }
  }
  const reviewer = verifySession(deps.sessionSecret, parseCookies(req.headers.cookie).reviewer);
  if (!reviewer) return redirect(res, "/login");
  if (path === "/logout" && method === "POST")
    return redirect(res, "/login", { "set-cookie": "reviewer=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" });
  try {
    await pages(deps, reviewer, method, path, req, res);
  } catch (e) {
    const status = statusOf(e);
    if (status === 500) console.error(e);
    send(
      res,
      status,
      "text/html; charset=utf-8",
      page("Error", errorView(status === 500 ? "Internal error" : errorText(e))),
    );
  }
}

export function createApp(deps: AppDeps): Server {
  return createServer((req, res) => {
    handle(deps, req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, "text/plain", "Internal error");
      else res.end();
    });
  });
}
