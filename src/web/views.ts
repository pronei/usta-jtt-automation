import { html, type Html } from "./html.js";
import type { PipelineState } from "../domain/pipeline-state.js";
import type { ApprovedMatch, OfficialMatchContext, ValidationIssue } from "../domain/schemas.js";
import type { ObservedCard } from "../pipeline/dry-run.js";
import type { Draft, ErrorsCaught, Review } from "./reconcile.js";
import { STATUS_LABEL } from "./fill.js";
import { MATCH_ENTRY_URL } from "./context.js";

export type JobRow = {
  id: string;
  state: PipelineState;
  created_at: string;
  match_id: string | null;
  home_team: string | null;
  away_team: string | null;
  code: string | null;
};
export type JobModel = {
  job: { id: string; state: PipelineState; revision: number };
  code: { code: string; expires_at: string } | null;
  card: ObservedCard | null;
  swapped: boolean;
  context: OfficialMatchContext | null;
  draft: Draft | null;
  review: Review | null;
  issues: ValidationIssue[] | null;
  mismatches: { id: string; expected: string; actual: string }[] | null;
  approval: ApprovedMatch | null;
  errors: ErrorsCaught | null;
  receipt: string | null;
};

const nav = html`<p><a href="/">Matches</a> · <a href="/bookmarklet">Bookmark</a> · <a href="/report">Report</a> · <form method="post" action="/logout" style="display:inline"><button type="submit">Sign out</button></form></p>`;

export function loginView(error: string | null): Html {
  return html`<h1>Score entry</h1>
    ${error ? html`<p class="error">ERROR: ${error}</p>` : null}
    <form method="post" action="/login" class="card">
      <label for="token">Reviewer token</label>
      <input id="token" name="token" type="password" autocomplete="off" required />
      <p><button type="submit" class="primary">Sign in</button></p>
    </form>`;
}

export function listView(rows: JobRow[]): Html {
  return html`${nav}<h1>Matches</h1>
    <form method="post" action="/upload" enctype="multipart/form-data" class="card">
      <label for="pdf">Scorecard: the digital PDF, or a JSON export from the Momentum platform</label>
      <input id="pdf" name="pdf" type="file" accept="application/pdf,application/json,.json" required />
      <p><button type="submit" class="primary">Upload</button></p>
    </form>
    <table>
      <tr><th>Match</th><th>Home</th><th>Away</th><th>State</th><th>Code</th><th>Uploaded</th></tr>
      ${rows.map(
        (r) => html`<tr>
          <td class="n"><a href="/jobs/${r.id}">${r.match_id ?? "(no match id)"}</a></td>
          <td>${r.home_team ?? ""}</td><td>${r.away_team ?? ""}</td>
          <td class="n">${r.state}</td><td class="n">${r.code ?? "expired"}</td>
          <td class="n">${r.created_at.slice(0, 16).replace("T", " ")}</td>
        </tr>`,
      )}
    </table>`;
}

/** The bookmark. It loads the fill script only on TennisLink, so the script never runs on the USTA sign-in page. */
export function bookmarkletHref(publicUrl: string): string {
  const origin = new URL(publicUrl).origin;
  return `javascript:(function(){if(location.hostname!=='tennislink.usta.com'){alert('This bookmark works on tennislink.usta.com. Sign in to TennisLink, open the Score Card page for the match, then tap it again.');return;}var s=document.createElement('script');s.src='${origin}/fill.js?'+Date.now();document.body.appendChild(s);})();`;
}

export function bookmarkletView(publicUrl: string): Html {
  const href = bookmarkletHref(publicUrl);
  return html`${nav}<h1>The bookmark</h1>
    <div class="card">
      <p>Drag this link to the bookmarks bar, or long-press and copy its address: <a href="${href}">Score entry</a></p>
      <p>On a phone: save any page as a bookmark, then edit the bookmark and replace its address with:</p>
      <pre class="mono" style="white-space:pre-wrap;word-break:break-all">${href}</pre>
      <p>Use: sign in to TennisLink, then open the <a href="${MATCH_ENTRY_URL}">match entry page</a> again (signing in does not return you there), type the match number, and on the match's Score Card tap the bookmark and enter the match code. Tap it again after Finish.</p>
    </div>`;
}

const stateText: Partial<Record<PipelineState, string>> = {
  MATCH_DISCOVERED: "Waiting for the coach: on the match's Score Card page on TennisLink, tap the bookmark and enter the code.",
  OFFICIAL_CONTEXT_CAPTURED: "Form captured. Check the names and scores below, then validate.",
  NEEDS_REVIEW: "Validation found problems. Correct them below and validate again.",
  VALIDATED: "Valid. Approve to release it to the coach for filling.",
  APPROVED: "Approved. Coach: on the Score Card page, tap the bookmark and enter the code; it fills the form.",
  POPULATING_TENNISLINK: "The coach's browser is filling the form.",
  SUBMITTING: "Filled and read back. Waiting for the coach to press Next, then Finish, then tap the bookmark on the page that follows.",
  SUBMISSION_UNKNOWN: "Outcome unknown. Check the match on TennisLink by hand before doing anything else.",
  SUBMITTED: "Submitted.",
  FAILED: "Failed. Start a new job from the PDF.",
};

/** The states in which the coach has a step to take on TennisLink: capture, fill, receipt. */
const COACH_STATES: PipelineState[] = ["MATCH_DISCOVERED", "APPROVED", "SUBMITTING"];

function coachCard(matchId: string, code: string, teams: string): Html {
  const message = [
    `Match ${matchId}: ${teams}`,
    `1. Open the TennisLink match entry page: ${MATCH_ENTRY_URL}`,
    `   If it asks you to sign in, sign in, then open that link again.`,
    `2. Type match number ${matchId} and continue to its Score Card.`,
    `3. Tap the Score entry bookmark. Code: ${code}`,
  ].join("\n");
  return html`<div class="card">
    <h2>For the coach</h2>
    <ol>
      <li>Open the TennisLink <a href="${MATCH_ENTRY_URL}">match entry page</a>. If it asks you to sign in (Sign In at the top), sign in, then open the link again: TennisLink does not bring you back.</li>
      <li>Type match number <span class="mono">${matchId}</span> and continue to its Score Card.</li>
      <li>Tap the Score entry bookmark and enter code <span class="mono">${code}</span>.</li>
    </ol>
    <p class="muted">To send to a coach:</p>
    <pre class="mono" style="white-space:pre-wrap;word-break:break-all">${message}</pre>
  </div>`;
}

const statusOptions = [...(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]), "unknown"] as const;

function lineForm(m: JobModel, i: number): Html {
  const d = m.draft!.lines[i]!,
    ctx = m.context!,
    r = m.review?.lines[i] ?? null;
  const slot = (side: "home" | "away", k: number) => {
    const s = d[side][k]!,
      roster = ctx[`${side}_team`].roster,
      chosen = r ? r[side][k] ?? "" : s.chosen ?? "";
    return html`<div>
      <select name="l${i}.${side}.${k}" aria-label="${side} player ${k + 1}">
        <option value="">(choose)</option>
        ${roster.map((p) => html`<option value="${p.player_id}" ${p.player_id === chosen ? html`selected` : null}>${p.display_name}</option>`)}
      </select>
      <div class="muted mono">printed: ${s.observed || "(blank)"} · ${s.resolution}${s.resolution === "ambiguous" ? html` (${s.candidates.map((c) => c.display_name).join(", ")})` : null}</div>
    </div>`;
  };
  const status = r?.status ?? d.suggested_status,
    winner = r?.winner ?? "";
  return html`<tr>
    <td class="n">${d.position}${d.found ? null : html` <span class="error">not on the card</span>`}</td>
    <td>${d.home.map((_, k) => slot("home", k))}</td>
    <td>${d.away.map((_, k) => slot("away", k))}</td>
    <td><input type="number" min="0" name="l${i}.home_games" value="${r ? r.home_games ?? "" : d.home_games ?? ""}" style="width:5em" aria-label="home games" /> –
        <input type="number" min="0" name="l${i}.away_games" value="${r ? r.away_games ?? "" : d.away_games ?? ""}" style="width:5em" aria-label="away games" /></td>
    <td><select name="l${i}.status" aria-label="result">
      ${statusOptions.map((s) => html`<option value="${s}" ${s === status ? html`selected` : null}>${s === "unknown" ? "(choose)" : STATUS_LABEL[s]}</option>`)}
    </select></td>
    <td><select name="l${i}.winner" aria-label="winner">
      <option value="" ${winner === "" ? html`selected` : null}>by score</option>
      <option value="home" ${winner === "home" ? html`selected` : null}>home</option>
      <option value="away" ${winner === "away" ? html`selected` : null}>away</option>
    </select></td>
  </tr>`;
}

export function jobView(m: JobModel): Html {
  const state = m.job.state,
    id = m.job.id;
  const teams = m.context
    ? `${m.context.home_team.team_name} vs ${m.context.away_team.team_name}`
    : m.card
      ? `${m.card.home_team} vs ${m.card.away_team} (as printed)`
      : "";
  const canEdit = state === "OFFICIAL_CONTEXT_CAPTURED" || state === "NEEDS_REVIEW";
  const canSwap = state === "MATCH_DISCOVERED" || canEdit;
  return html`${nav}
    <h1>Match ${m.card?.match_id ?? ""}</h1>
    <p>${teams}</p>
    <div class="card">
      <p class="mono">STATE: ${state}</p>
      <p>${stateText[state] ?? ""}</p>
      ${m.code
        ? html`<p>Match code <span class="code">${m.code.code}</span> <span class="muted mono">until ${m.code.expires_at.slice(0, 16).replace("T", " ")}</span></p>`
        : html`<p class="error">ERROR: no valid code</p>`}
      <form method="post" action="/jobs/${id}/code" style="display:inline"><button type="submit">New code</button></form>
      ${canSwap ? html`<form method="post" action="/jobs/${id}/orientation" style="display:inline"><button type="submit">${m.swapped ? "Undo swap" : "Swap sides"}</button></form>` : null}
      ${state === "VALIDATED" ? html`<form method="post" action="/jobs/${id}/approve" style="display:inline"><button type="submit" class="primary">Approve</button></form>
        <form method="post" action="/jobs/${id}/reopen" style="display:inline"><button type="submit">Reopen</button></form>` : null}
      ${state === "SUBMITTING" ? html`<form method="post" action="/jobs/${id}/unknown" style="display:inline"><button type="submit">Mark outcome unknown</button></form>` : null}
    </div>
    ${m.card && m.code && COACH_STATES.includes(state) ? coachCard(m.card.match_id, m.code.code, teams) : null}
    ${m.context && m.context.result_status !== "unreported" ? html`<p class="error">ERROR: TennisLink already shows scores for this match. Nothing will be filled.</p>` : null}
    ${m.issues ? html`<div class="card"><h2>Problems</h2><ul>${m.issues.map((i) => html`<li class="error">ERROR: ${i.path || "match"}: ${i.message} (${i.code})</li>`)}</ul></div>` : null}
    ${m.mismatches ? html`<div class="card"><h2>Read-back differed</h2><table><tr><th>Field</th><th>Expected</th><th>Found</th></tr>${m.mismatches.map((x) => html`<tr><td class="n">${x.id}</td><td class="n">${x.expected}</td><td class="n">${x.actual}</td></tr>`)}</table></div>` : null}
    ${m.card
      ? html`<div class="card"><h2>As printed${m.swapped ? " (sides swapped)" : ""}</h2>
          <table><tr><th>Line</th><th>${m.card.home_team}</th><th>${m.card.away_team}</th><th>Games</th></tr>
          ${m.card.lines.map((l) => html`<tr><td class="n">${l.position_text}</td><td>${l.home_names.join(" / ")}</td><td>${l.away_names.join(" / ")}</td><td class="n">${l.home_games}–${l.away_games}</td></tr>`)}
          <tr><td></td><td></td><td>printed totals</td><td class="n">${m.card.printed_home_total}–${m.card.printed_away_total}</td></tr>
          <tr><td></td><td></td><td>computed totals</td><td class="n">${m.card.lines.reduce((n, l) => n + (l.home_games ?? 0), 0)}–${m.card.lines.reduce((n, l) => n + (l.away_games ?? 0), 0)}</td></tr></table></div>`
      : null}
    ${m.draft && canEdit
      ? html`<form method="post" action="/jobs/${id}/reconcile" class="card">
          <h2>Official entry</h2>
          <table><tr><th>Line</th><th>${m.context!.home_team.team_name}</th><th>${m.context!.away_team.team_name}</th><th>Games (home–away)</th><th>Result</th><th>Winner</th></tr>
          ${m.draft.lines.map((_, i) => lineForm(m, i))}</table>
          <p><button type="submit" class="primary">Validate</button></p>
        </form>`
      : null}
    ${m.approval
      ? html`<div class="card"><h2>Approved</h2><p class="mono">${m.approval.approved_by} · ${m.approval.approved_at.slice(0, 16).replace("T", " ")} · ${m.approval.approval_id}</p>
          <table><tr><th>Line</th><th>Home</th><th>Away</th><th>Games (home–away)</th><th>Boxes (winner first)</th><th>Result</th><th>Winner</th></tr>
          ${m.approval.validation.payload.lines.map((l) => html`<tr><td class="n">${l.position}</td><td class="n">${l.home_player_ids.join(", ")}</td><td class="n">${l.away_player_ids.join(", ")}</td><td class="n">${l.sets.map((s) => `${s.home}–${s.away}`).join(" ") || "(none)"}</td><td class="n">${l.sets.map((s) => (l.winner === "away" ? `${s.away}–${s.home}` : `${s.home}–${s.away}`)).join(" ") || "(none)"}</td><td>${STATUS_LABEL[l.status]}</td><td>${l.winner ?? "(none)"}</td></tr>`)}</table></div>`
      : null}
    ${m.errors
      ? html`<div class="card"><h2>Errors caught</h2><p class="mono">roster ${m.errors.roster_mismatch} · not completed ${m.errors.status_not_completed} · winner-first ${m.errors.winner_first_reorder} · totals ${m.errors.totals_mismatch} · score edits ${m.errors.score_edited} · total ${m.errors.total}</p></div>`
      : null}
    ${m.receipt ? html`<div class="card"><h2>Receipt</h2><pre class="mono" style="white-space:pre-wrap">${m.receipt}</pre></div>` : null}`;
}

export function errorView(message: string): Html {
  return html`${nav}<h1>Something refused</h1><p class="error">ERROR: ${message}</p><p><a href="/">Back to matches</a></p>`;
}

export function reportView(markdown: string): Html {
  return html`${nav}<h1>Season report</h1>
    <pre class="mono" style="white-space:pre-wrap">${markdown}</pre>
    <form method="post" action="/baselines" class="card">
      <h2>Record a manual entry time</h2>
      <p class="muted">Time a match entered by hand, from opening the scorecard to pressing Finish. At least three before the bookmarklet is used.</p>
      <label for="b-match">Match id</label><input id="b-match" name="match_id" required pattern="[0-9]+" />
      <label for="b-min">Minutes</label><input id="b-min" name="minutes" type="number" step="0.5" min="0.5" required />
      <label for="b-note">Note (device, paper or PDF, who)</label><input id="b-note" name="note" maxlength="500" />
      <p><button type="submit" class="primary">Record</button></p>
    </form>`;
}
