import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import {
  CapturedFormSchema,
  DATE_CONTROL_ID,
  MATCH_ENTRY_URL,
  PREFIX,
  contextFromForm,
  scoreCardUrl,
} from "../src/web/context.js";
import { buildFillPlan } from "../src/web/fill.js";
import { approvedFixture, formatRules } from "./web-fixtures.js";

const APP = "https://app.test";
const PAGE = "https://tennislink.usta.com/TeamTennis/Secure/MatchScoreCard.aspx?MatchID=123456&MatchTab=M&Preview=No";
const CORS = {
  "access-control-allow-origin": "https://tennislink.usta.com",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

/** A page whose TennisLink is the fixture and whose app is a scripted API; returns what the script posted. */
async function openWith(stage: string, plan: unknown = null, url = PAGE, body?: string) {
  const posts: { path: string; body: unknown }[] = [];
  let dialogs = 0;
  const context = await browser.newContext();
  const page = await context.newPage();
  const fixture = await readFile("tests/fixtures/scorecard-form.html", "utf8");
  const script = await readFile("public/fill.js", "utf8");
  await page.route("https://tennislink.usta.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: body ?? fixture }),
  );
  await page.route(`${APP}/**`, async (route) => {
    const url = new URL(route.request().url());
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === "/fill.js")
      return route.fulfill({ status: 200, contentType: "text/javascript", body: script });
    if (route.request().method() === "POST") posts.push({ path: url.pathname, body: route.request().postDataJSON() });
    if (url.pathname === "/api/handshake")
      return reply({ job_id: "00000000-0000-0000-0000-000000000000", match_id: "123456", stage, state: "X" });
    if (url.pathname.endsWith("/context")) return reply({ ok: true, result_status: "unreported" });
    if (url.pathname.endsWith("/fill")) return reply(plan);
    if (url.pathname.endsWith("/readback")) return reply({ ok: true, mismatches: [], note: "Press Next." });
    return reply({ error: "unexpected " + url.pathname });
  });
  page.on("dialog", (d) => {
    dialogs++;
    void d.accept("ABCD2345");
  });
  await page.goto(url);
  await page.addScriptTag({ url: `${APP}/fill.js` });
  await page.waitForSelector("#jtt-overlay");
  return { page, posts, dialogs: () => dialogs, close: () => context.close() };
}

test("capture: the script posts a form the server can turn into a context", async () => {
  const { page, posts, close } = await openWith("capture");
  try {
    assert.match((await page.textContent("#jtt-overlay")) ?? "", /Captured/);
    const post = posts.find((p) => p.path.endsWith("/context"))!;
    const captured = CapturedFormSchema.parse((post.body as { captured: unknown }).captured);
    assert.equal(captured.match_id, "123456");
    assert.equal(captured.labels.length, 2);
    assert.match(captured.labels[1]!.text, /^# 1 {1,2}Doubles - Scoring Format: Short Set \(4 Games\)$/);
    const { context, form } = contextFromForm(captured, formatRules);
    assert.equal(context.away_team.team_id, "5083526172");
    assert.equal(form.lines[1]!.control, "ctl01");
    assert.equal(form.result_options.length, 5);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("jtt_code")), "ABCD2345");
  } finally {
    await close();
  }
});

test("fill: the script sets every planned field and posts the read-back", async () => {
  const { approved, context, form } = approvedFixture();
  const plan = buildFillPlan(approved, context, form);
  const { page, posts, close } = await openWith("fill", plan);
  try {
    assert.match((await page.textContent("#jtt-overlay")) ?? "", /Every field matches/);
    assert.equal(await page.inputValue(`#${DATE_CONTROL_ID}`), "09/13/2026");
    assert.equal(await page.inputValue(`#${PREFIX}ctl00_HomeTeam_Set1`), "3");
    assert.equal(await page.inputValue(`#${PREFIX}ctl00_VisitingTeam_Set1`), "1");
    assert.equal(await page.inputValue(`#${PREFIX}ctl00_resultId`), "5");
    assert.equal(await page.inputValue(`#${PREFIX}ctl01_HomeTeam_Player2`), "h4");
    assert.equal(await page.inputValue(`#${PREFIX}ctl01_Winning_TeamId`), "524502");
    const readback = posts.find((p) => p.path.endsWith("/readback"))!.body as { fields: Record<string, string> };
    assert.equal(Object.keys(readback.fields).length, plan.ops.length);
    assert.equal(readback.fields[`${PREFIX}ctl00_resultId`], "5");
    assert.equal(await page.inputValue(`#ctl00_mainContent_MatchIndividual1_cmdSubmit`), "Next");
  } finally {
    await close();
  }
});

const plainPage = (text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><p>${text}</p></body></html>`;

test("on another TennisLink page the script takes the code and links to the match's Score Card", async () => {
  const { page, posts, close } = await openWith("capture", null, MATCH_ENTRY_URL, plainPage("Enter match number"));
  try {
    assert.match((await page.textContent("#jtt-overlay")) ?? "", /Code accepted for match 123456/);
    assert.equal(await page.getAttribute("#jtt-overlay a", "href"), scoreCardUrl("123456"));
    assert.deepEqual(posts.map((p) => p.path), ["/api/handshake"]);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("jtt_code")), "ABCD2345");
  } finally {
    await close();
  }
});

test("on TennisLink's refusal page the script explains signing in and calls nothing", async () => {
  const { page, posts, dialogs, close } = await openWith(
    "capture",
    null,
    "https://tennislink.usta.com/TeamTennis/AccessDenied.htm",
    plainPage("You do not have Privileges To Perform This Action."),
  );
  try {
    assert.match((await page.textContent("#jtt-overlay")) ?? "", /signed out/);
    assert.equal(await page.getAttribute("#jtt-overlay a", "href"), MATCH_ENTRY_URL);
    assert.equal(posts.length, 0);
    assert.equal(dialogs(), 0);
  } finally {
    await close();
  }
});

test("a code for another match links to that match and is forgotten", async () => {
  const { page, close } = await openWith("capture", null, PAGE.replace("MatchID=123456", "MatchID=999999"));
  try {
    assert.match((await page.textContent("#jtt-overlay")) ?? "", /this page is match 999999/);
    assert.equal(await page.getAttribute("#jtt-overlay a", "href"), scoreCardUrl("123456"));
    assert.equal(await page.evaluate(() => sessionStorage.getItem("jtt_code")), null);
  } finally {
    await close();
  }
});

test("confirm on a blank score card records no receipt", async () => {
  const { page, posts, close } = await openWith("confirm");
  try {
    assert.match((await page.textContent("#jtt-overlay")) ?? "", /nothing was submitted/);
    assert.ok(!posts.some((p) => p.path.endsWith("/receipt")));
  } finally {
    await close();
  }
});
