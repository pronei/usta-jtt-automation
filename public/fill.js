/* Score entry fill script. Loaded by a bookmark into the coach's own TennisLink tab.
   It captures the form, fills it from the approved result and reads it back, and records the receipt.
   It never presses Next or Finish and never touches credentials or cookies. */
(function () {
  "use strict";
  var PREFIX = "ctl00_mainContent_MatchIndividual1_Match_Ind_";
  var DATE_ID = "ctl00_mainContent_MatchIndividual1_MatchActualDate";
  var LABEL = /^#\s*\d+\s+(Singles|Doubles)\s*-\s*Scoring Format:/;

  function pageKind(loc) {
    if (loc.hostname !== "tennislink.usta.com") return "other";
    if (loc.pathname.toLowerCase() !== "/teamtennis/secure/matchscorecard.aspx") return "other";
    var preview = (new URLSearchParams(loc.search).get("Preview") || "No").toLowerCase();
    return preview === "yes" ? "preview" : "entry";
  }
  function matchIdOf(loc) {
    return new URLSearchParams(loc.search).get("MatchID") || "";
  }
  function ownText(node) {
    var t = "", k;
    for (k = 0; k < node.childNodes.length; k++)
      if (node.childNodes[k].nodeType === 3) t += node.childNodes[k].nodeValue;
    return t.replace(/\s+/g, " ").trim();
  }
  function lineLabel(tbl) {
    var els = tbl.querySelectorAll("*"), i, t;
    for (i = 0; i < els.length; i++) {
      t = ownText(els[i]);
      if (LABEL.test(t)) return t;
    }
    t = ownText(tbl);
    return LABEL.test(t) ? t : "";
  }
  function readForm(doc, loc) {
    var controls = [], labels = [], nodes = doc.querySelectorAll("select, input"), i, j, n, c;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (!n.id || (n.id.indexOf(PREFIX) !== 0 && n.id !== DATE_ID)) continue;
      c = {
        id: n.id,
        tag: n.tagName,
        type: n.getAttribute("type"),
        value: n.value || "",
        has_onchange: !!(n.getAttribute("onchange") || n.onchange)
      };
      if (n.tagName === "SELECT") {
        c.options = [];
        for (j = 0; j < n.options.length; j++)
          c.options.push({ label: (n.options[j].text || "").trim(), value: n.options[j].value });
      }
      controls.push(c);
    }
    var tables = doc.querySelectorAll("[id$='_tblMatch_Ind']");
    for (i = 0; i < tables.length; i++) labels.push({ id: tables[i].id, text: lineLabel(tables[i]) });
    return {
      url: loc.href,
      match_id: matchIdOf(loc),
      captured_at: new Date().toISOString(),
      header_text: (doc.body.innerText || doc.body.textContent || "").slice(0, 6000),
      labels: labels,
      controls: controls
    };
  }
  function applyOps(doc, ops) {
    var problems = [], i, j, op, node, found;
    for (i = 0; i < ops.length; i++) {
      op = ops[i];
      node = doc.getElementById(op.id);
      if (!node) { problems.push(op.id + ": not found"); continue; }
      if (op.kind === "select") {
        found = false;
        for (j = 0; j < node.options.length; j++) if (node.options[j].value === op.value) found = true;
        if (!found) { problems.push(op.id + ': no option "' + op.value + '"'); continue; }
      }
      node.value = op.value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return problems;
  }
  function readFields(doc, ids) {
    var out = {}, i, node;
    for (i = 0; i < ids.length; i++) {
      node = doc.getElementById(ids[i]);
      if (node) out[ids[i]] = node.value || "";
    }
    return out;
  }

  function show(text) {
    var old = document.getElementById("jtt-overlay");
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement("div");
    box.id = "jtt-overlay";
    box.setAttribute("style", "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#1c3655;color:#f7f7f7;font:16px/1.5 -apple-system,system-ui,sans-serif;padding:16px;white-space:pre-wrap;border:2px solid #e8a33d;max-height:60vh;overflow:auto");
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.setAttribute("style", "float:right;font:inherit;padding:4px 12px;margin-left:12px");
    close.onclick = function () { box.parentNode.removeChild(box); };
    box.appendChild(close);
    box.appendChild(document.createTextNode(text));
    document.body.appendChild(box);
  }
  function request(app, path, method, body) {
    return fetch(app + path, {
      method: method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit"
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.error ? data.error : "HTTP " + r.status);
        return data;
      });
    });
  }

  function main(app) {
    var kind = pageKind(location);
    if (kind === "other") { alert("Open the match's Score Card page on tennislink.usta.com, then tap the bookmark."); return; }
    var pageMatch = matchIdOf(location);
    var code = sessionStorage.getItem("jtt_code") || prompt("Match code from the score-entry app");
    if (!code) return;
    code = code.trim().toUpperCase();
    request(app, "/api/handshake", "POST", { code: code }).then(function (h) {
      if (h.match_id !== pageMatch) throw new Error("This code is for match " + h.match_id + "; this page is match " + pageMatch + ".");
      sessionStorage.setItem("jtt_code", code);
      var job = "/api/jobs/" + h.job_id;
      if (h.stage === "capture") {
        if (kind !== "entry") throw new Error("Open the Score Card entry page (not the preview) to capture.");
        return request(app, job + "/context", "POST", { code: code, captured: readForm(document, location) }).then(function (r) {
          show(r.result_status === "unreported"
            ? "Captured. Go back to the app to check names and scores."
            : "Captured, but TennisLink already shows scores for this match. Nothing will be filled.");
        });
      }
      if (h.stage === "fill") {
        if (kind !== "entry") throw new Error("Open the Score Card entry page to fill.");
        return request(app, job + "/fill?code=" + encodeURIComponent(code), "GET").then(function (plan) {
          var problems = applyOps(document, plan.ops);
          if (problems.length) { show("Could not fill. Nothing was submitted.\n" + problems.join("\n")); return; }
          var ids = plan.ops.map(function (o) { return o.id; });
          return request(app, job + "/readback", "POST", { code: code, fields: readFields(document, ids) }).then(function (r) {
            if (r.ok) show("Every field matches the approved result.\n\n" + (r.note || ""));
            else show("Read-back differs from the approved result. Nothing was submitted. Fix it in the app and re-approve.\n\n" +
              r.mismatches.map(function (m) { return m.id.replace(PREFIX, "") + ": expected " + JSON.stringify(m.expected) + ", found " + JSON.stringify(m.actual); }).join("\n"));
          });
        });
      }
      if (h.stage === "confirm") {
        return request(app, job + "/receipt", "POST", {
          code: code,
          url: location.href,
          page_text: (document.body.innerText || document.body.textContent || "").replace(/\s+/g, " ").slice(0, 4000)
        }).then(function () {
          sessionStorage.removeItem("jtt_code");
          show("Submission recorded. Done.");
        });
      }
      if (h.stage === "done") { show("This match is already recorded as submitted."); return; }
      show("The reviewer has work to do in the app first (state " + h.state + ").");
    }).catch(function (e) {
      show("Stopped: " + (e && e.message ? e.message : e));
    });
  }

  window.__jtt = { pageKind: pageKind, readForm: readForm, applyOps: applyOps, readFields: readFields, main: main };
  var script = document.currentScript;
  if (script && script.src) main(new URL(script.src).origin);
})();
