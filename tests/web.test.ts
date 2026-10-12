import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/database.js";
import { DATE_CONTROL_ID, PREFIX } from "../src/web/context.js";
import { createApp } from "../src/web/server.js";
import type { Extractor } from "../src/web/upload.js";
import { shortSetRules } from "./fixtures.js";
import { capturedForm, exportDocument, formatRules, observations, reviewParams } from "./web-fixtures.js";

const TOKEN = "t".repeat(24);
const extractor: Extractor = async (pdfPath) => ({
  ...observations,
  source_path: pdfPath,
  source_sha256: createHash("sha256").update(await readFile(pdfPath)).digest("hex"),
});
const dir = mkdtempSync(join(tmpdir(), "jtt-web-"));
const store = new Store(":memory:");
const app = createApp({
  store,
  reviewers: [{ name: "Coach A", token: TOKEN }],
  sessionSecret: "s".repeat(32),
  publicUrl: "http://localhost",
  uploadDir: dir,
  extractor,
  scoringRules: shortSetRules,
  formatRules,
  fillScript: "/* placeholder */",
});
await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
after(() => {
  app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

let cookie = "";
const get = (path: string) => fetch(base + path, { headers: { cookie }, redirect: "manual" });
const post = (path: string, body: URLSearchParams | FormData) =>
  fetch(base + path, { method: "POST", headers: { cookie }, body, redirect: "manual" });
const api = (path: string, body: unknown = null, method = "POST") =>
  fetch(base + path, {
    method,
    headers: { "content-type": "application/json", origin: "https://tennislink.usta.com" },
    body: method === "POST" ? JSON.stringify(body) : null,
  });
const stage = async (code: string) => ((await (await api("/api/handshake", { code })).json()) as { stage: string }).stage;

let jobId = "",
  code = "";

test("pages need a reviewer session; a token signs in", async () => {
  assert.equal((await get("/")).status, 303);
  const bad = await post("/login", new URLSearchParams({ token: "wrong" }));
  assert.equal(bad.headers.get("location"), "/login?error=Unknown+token");
  const ok = await post("/login", new URLSearchParams({ token: TOKEN }));
  assert.equal(ok.status, 303);
  cookie = ok.headers.get("set-cookie")!.split(";")[0]!;
  assert.match(cookie, /^reviewer=/);
  assert.equal((await get("/")).status, 200);
  assert.equal((await get("/fill.js")).headers.get("content-type"), "text/javascript; charset=utf-8");
});

test("upload creates a job with a code", async () => {
  const form = new FormData();
  form.set("pdf", new Blob([Buffer.from("%PDF-1.4 e2e")], { type: "application/pdf" }), "cards.pdf");
  assert.equal((await post("/upload", form)).status, 303);
  jobId = store.listJobs()[0]!.id;
  code = store.codeFor(jobId)!.code;
  const list = await (await get("/")).text();
  assert.ok(list.includes("123456") && list.includes(code) && list.includes("MATCH_DISCOVERED"));
});

test("handshake reports the stage; capture moves the job to OFFICIAL_CONTEXT_CAPTURED", async () => {
  const h = await api("/api/handshake", { code });
  assert.equal(h.headers.get("access-control-allow-origin"), "https://tennislink.usta.com");
  assert.deepEqual(await h.json(), { job_id: jobId, match_id: "123456", stage: "capture", state: "MATCH_DISCOVERED" });
  assert.equal((await api("/api/handshake", { code: "NOPE1234" })).status, 404);
  assert.equal((await fetch(base + "/api/handshake", { method: "OPTIONS" })).status, 204);
  const c = await api(`/api/jobs/${jobId}/context`, { code, captured: capturedForm });
  assert.equal(c.status, 200);
  assert.equal(store.getJob(jobId).state, "OFFICIAL_CONTEXT_CAPTURED");
  assert.equal((await api(`/api/jobs/${jobId}/context`, { code, captured: capturedForm })).status, 409);
  assert.equal(await stage(code), "wait");
  const text = await (await get(`/jobs/${jobId}`)).text();
  assert.ok(text.includes('name="l0.home.0"') && text.includes("Home Player") && text.includes("Timed Match"));
});

test("reconcile validates, shows problems, and approval records the errors caught", async () => {
  const bad = reviewParams();
  bad.set("l0.home.0", "");
  await post(`/jobs/${jobId}/reconcile`, bad);
  assert.equal(store.getJob(jobId).state, "NEEDS_REVIEW");
  assert.ok((await (await get(`/jobs/${jobId}`)).text()).includes("PLAYER_IDENTITY"));
  await post(`/jobs/${jobId}/reconcile`, reviewParams());
  assert.equal(store.getJob(jobId).state, "VALIDATED");
  assert.equal(await stage(code), "wait");
  assert.equal((await post(`/jobs/${jobId}/approve`, new URLSearchParams())).status, 303);
  assert.equal(store.getJob(jobId).state, "APPROVED");
  assert.deepEqual(store.latestArtifact(jobId, "ERRORS_CAUGHT"), {
    roster_mismatch: 0,
    status_not_completed: 1,
    winner_first_reorder: 0,
    totals_mismatch: 0,
    score_edited: 0,
    total: 1,
  });
  assert.equal(await stage(code), "fill");
});

test("fill plan, a failed then a matching read-back, and the receipt take the job to SUBMITTED", async () => {
  const plan = (await (await api(`/api/jobs/${jobId}/fill?code=${code}`, null, "GET")).json()) as {
    ops: { id: string; value: string }[];
  };
  const fields = Object.fromEntries(plan.ops.map((o) => [o.id, o.value]));
  assert.equal(fields[DATE_CONTROL_ID], "09/13/2026");
  assert.equal(fields[`${PREFIX}ctl00_resultId`], "5");
  const wrong = (await (
    await api(`/api/jobs/${jobId}/readback`, { code, fields: { ...fields, [`${PREFIX}ctl00_HomeTeam_Set1`]: "9" } })
  ).json()) as { ok: boolean };
  assert.equal(wrong.ok, false);
  assert.equal(store.getJob(jobId).state, "NEEDS_REVIEW");
  assert.ok((await (await get(`/jobs/${jobId}`)).text()).includes("Read-back differed"));
  await post(`/jobs/${jobId}/reconcile`, reviewParams());
  await post(`/jobs/${jobId}/approve`, new URLSearchParams());
  assert.equal(store.getJob(jobId).state, "APPROVED");
  const ok = (await (await api(`/api/jobs/${jobId}/readback`, { code, fields })).json()) as { ok: boolean };
  assert.equal(ok.ok, true);
  assert.equal(store.getJob(jobId).state, "SUBMITTING");
  assert.equal(await stage(code), "confirm");
  const r = await api(`/api/jobs/${jobId}/receipt`, {
    code,
    url: "https://tennislink.usta.com/TeamTennis/Secure/MatchScoreCard.aspx?MatchID=123456&Preview=Yes",
    page_text: "Match #123456 Games 7 3",
  });
  assert.equal(r.status, 200);
  assert.equal(store.getJob(jobId).state, "SUBMITTED");
  assert.equal(await stage(code), "done");
  assert.ok((await (await get(`/jobs/${jobId}`)).text()).includes("Games 7 3"));
  assert.equal((await api(`/api/jobs/${jobId}/fill?code=${code}`, null, "GET")).status, 409);
});

test("the report page shows the season numbers and takes a baseline", async () => {
  const before = await (await get("/report")).text();
  assert.match(before, /submitted: 1/);
  assert.ok(before.includes("123456"));
  const r = await post("/baselines", new URLSearchParams({ match_id: "2743892", minutes: "19", note: "laptop, paper card" }));
  assert.equal(r.status, 303);
  const after = await (await get("/report")).text();
  assert.match(after, /2743892/);
  assert.match(after, /Median manual entry: 19 min \(1 recorded\)/);
  assert.equal((await post("/baselines", new URLSearchParams({ match_id: "x", minutes: "19", note: "" }))).status, 400);
  assert.ok(store.history(jobId).some((row) => row.event === "FILL_PLAN_SERVED"));
});

test("a platform scorecard export uploads like a PDF", async () => {
  const form = new FormData();
  form.set("pdf", new Blob([JSON.stringify(exportDocument)], { type: "application/json" }), "scorecard-654321.json");
  assert.equal((await post("/upload", form)).status, 303);
  const list = await (await get("/")).text();
  assert.ok(list.includes("654321"));
  const other = new FormData();
  other.set("pdf", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
  assert.equal((await post("/upload", other)).status, 400);
});

test("the job page tells the coach where to sign in, which page to open and which code to type", async () => {
  const job = store
    .listJobs()
    .find(
      (j) =>
        (store.latestArtifact(j.id, "MATCH_DISCOVERED") as { observed_card: { match_id: string } })
          .observed_card.match_id === "654321",
    )!;
  const jobCode = store.codeFor(job.id)!.code;
  const text = await (await get(`/jobs/${job.id}`)).text();
  assert.ok(text.includes("For the coach"));
  assert.ok(text.includes("EnterMatchNumber.aspx"));
  assert.ok(text.includes("Type match number 654321"));
  assert.ok(!text.includes("MatchScoreCard.aspx"));
  assert.ok(text.includes(`Code: ${jobCode}`));
  assert.ok(!(await (await get(`/jobs/${jobId}`)).text()).includes("For the coach"));
  const bookmark = await (await get("/bookmarklet")).text();
  assert.ok(bookmark.includes("location.hostname!==&#39;tennislink.usta.com&#39;"));
});
