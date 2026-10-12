import { test } from "node:test";
import assert from "node:assert/strict";
import { html, page, raw } from "../src/web/html.js";
import {
  ReviewersSchema,
  parseCookies,
  reviewerForToken,
  signSession,
  verifySession,
} from "../src/web/auth.js";
import { loadWebConfig } from "../src/web/config.js";
import { bookmarkletHref } from "../src/web/views.js";
import { runInNewContext } from "node:vm";

test("html escapes values, keeps fragments, renders arrays and drops null", () => {
  const inner = html`<b>${"<i>"}</b>`;
  assert.equal(
    html`<p>${"a&b"} ${inner} ${[1, 2]} ${null} ${raw("<hr>")}</p>`.__html,
    "<p>a&amp;b <b>&lt;i&gt;</b> 12  <hr></p>",
  );
  const doc = page("Title <x>", html`<p>body</p>`);
  assert.ok(doc.startsWith("<!doctype html>"));
  assert.ok(doc.includes("<title>Title &lt;x&gt;</title>"));
  assert.ok(doc.includes("<p>body</p>"));
});

test("reviewer tokens resolve to names and sessions are signed", () => {
  const reviewers = ReviewersSchema.parse([{ name: "Coach A", token: "x".repeat(16) }]);
  assert.equal(reviewerForToken(reviewers, "x".repeat(16)), "Coach A");
  assert.equal(reviewerForToken(reviewers, "y".repeat(16)), null);
  const secret = "s".repeat(32),
    cookie = signSession(secret, "Coach A");
  assert.equal(verifySession(secret, cookie), "Coach A");
  assert.equal(verifySession("t".repeat(32), cookie), null);
  const tampered = cookie.slice(0, -1) + (cookie.endsWith("x") ? "y" : "x");
  assert.equal(verifySession(secret, tampered), null);
  assert.equal(verifySession(secret, undefined), null);
  assert.deepEqual(parseCookies("a=1; reviewer=abc.def"), { a: "1", reviewer: "abc.def" });
  assert.throws(() => ReviewersSchema.parse([{ name: "A", token: "short" }]));
  assert.throws(() =>
    ReviewersSchema.parse([
      { name: "A", token: "x".repeat(16) },
      { name: "A", token: "y".repeat(16) },
    ]),
  );
});

test("web config needs a secret and an https public url", () => {
  const base = { WEB_PUBLIC_URL: "https://scores.example.org", WEB_SESSION_SECRET: "s".repeat(32) };
  const c = loadWebConfig(base);
  assert.equal(c.WEB_PORT, 8787);
  assert.equal(c.PYTHON_BIN, ".venv/bin/python");
  assert.equal(loadWebConfig({ ...base, WEB_PUBLIC_URL: "http://localhost:8787" }).WEB_PORT, 8787);
  assert.throws(() => loadWebConfig({ ...base, WEB_PUBLIC_URL: "http://scores.example.org" }));
  assert.throws(() => loadWebConfig({ ...base, WEB_SESSION_SECRET: "short" }));
  assert.throws(() => loadWebConfig({ WEB_SESSION_SECRET: "s".repeat(32) }));
});

test("the bookmark loads the fill script on TennisLink and nowhere else", () => {
  const href = bookmarkletHref("https://scores.example.org/");
  assert.ok(href.startsWith("javascript:"));
  const run = (hostname: string) => {
    const alerts: string[] = [],
      appended: { src: string }[] = [];
    runInNewContext(href.slice("javascript:".length), {
      location: { hostname },
      alert: (m: string) => alerts.push(m),
      Date,
      document: {
        createElement: () => ({ src: "" }),
        body: { appendChild: (n: { src: string }) => appended.push(n) },
      },
    });
    return { alerts, appended };
  };
  const signIn = run("account.usta.com");
  assert.equal(signIn.appended.length, 0);
  assert.match(signIn.alerts[0] ?? "", /tennislink\.usta\.com/);
  assert.equal(run("example.org").appended.length, 0);
  const ok = run("tennislink.usta.com");
  assert.equal(ok.alerts.length, 0);
  assert.match(ok.appended[0]?.src ?? "", /^https:\/\/scores\.example\.org\/fill\.js\?\d+$/);
});
