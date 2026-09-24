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
