export type Html = { readonly __html: string };
const escapeHtml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
function render(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (typeof v === "object" && "__html" in v) return (v as Html).__html;
  return escapeHtml(String(v));
}
/** Interpolated values are escaped unless they are Html fragments. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return { __html: out };
}
export const raw = (s: string): Html => ({ __html: s });
const CSS = `
:root{--page:#f7f7f7;--card:#ffffff;--ink:#1b1b1b;--muted:#46525e;--navy:#1c3655;--amber:#e8a33d;--error:#a8432d;--line:rgba(27,27,27,.16)}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:16px/1.55 "IBM Plex Sans",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1,h2,h3{font-weight:700;line-height:1.2;margin:0 0 12px}
.mono,code,td.n,th.n{font-family:"IBM Plex Mono",ui-monospace,monospace}.card{background:var(--card);border:1px solid var(--line);padding:16px;margin:0 0 16px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.error{color:var(--error);font-family:"IBM Plex Mono",ui-monospace,monospace}.muted{color:var(--muted)}
button,.button{display:inline-block;border:1px solid var(--ink);background:var(--card);color:var(--ink);padding:10px 20px;border-radius:48px;font:inherit;cursor:pointer;text-decoration:none}
button.primary{background:var(--amber);border-color:var(--amber)}
input,select{font:inherit;padding:6px 8px;border:1px solid var(--line);background:var(--card);min-height:44px}
label{display:block;margin:8px 0 4px}.code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:28px;letter-spacing:.1em}
`;
export function page(title: string, body: Html): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${body.__html}</main></body></html>`;
}
