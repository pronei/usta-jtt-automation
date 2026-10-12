/** The smallest document the fill script's pure functions need. */
export type FakeNode = { nodeType: number; nodeValue: string };
export type FakeEl = {
  id: string;
  tagName: string;
  value: string;
  options: { text: string; value: string }[];
  onchange: null;
  attrs: Record<string, string>;
  childNodes: FakeNode[];
  children: FakeEl[];
  events: string[];
  getAttribute(name: string): string | null;
  dispatchEvent(e: { type: string }): boolean;
  querySelectorAll(selector: string): FakeEl[];
};
export function el(
  init: Partial<Pick<FakeEl, "id" | "tagName" | "value" | "options" | "attrs" | "children">> & { text?: string },
): FakeEl {
  const node: FakeEl = {
    id: init.id ?? "",
    tagName: init.tagName ?? "DIV",
    value: init.value ?? "",
    options: init.options ?? [],
    onchange: null,
    attrs: init.attrs ?? {},
    childNodes: init.text ? [{ nodeType: 3, nodeValue: init.text }] : [],
    children: init.children ?? [],
    events: [],
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name]! : null;
    },
    dispatchEvent(e) {
      this.events.push(e.type);
      return true;
    },
    querySelectorAll() {
      return descendants(this);
    },
  };
  return node;
}
const descendants = (n: FakeEl): FakeEl[] => n.children.flatMap((c) => [c, ...descendants(c)]);
export function select(id: string, options: [string, string][], value = "", onchange?: string): FakeEl {
  return el({
    id,
    tagName: "SELECT",
    value,
    options: options.map(([text, value]) => ({ text, value })),
    attrs: onchange ? { onchange } : {},
  });
}
export const input = (id: string, value = "") => el({ id, tagName: "INPUT", value, attrs: { type: "text" } });
export function table(id: string, label: string): FakeEl {
  return el({ id, tagName: "TABLE", children: [el({ tagName: "TD", text: label })] });
}
export function makeDoc(elements: FakeEl[], bodyText: string) {
  const all = elements.flatMap((e) => [e, ...descendants(e)]);
  return {
    body: { innerText: bodyText, textContent: bodyText },
    currentScript: null,
    getElementById: (id: string) => all.find((e) => e.id === id) ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === "select, input")
        return all.filter((e) => e.tagName === "SELECT" || e.tagName === "INPUT");
      const suffix = /^\[id\$='(.+)'\]$/.exec(selector);
      return suffix ? all.filter((e) => e.id.endsWith(suffix[1]!)) : [];
    },
  };
}
