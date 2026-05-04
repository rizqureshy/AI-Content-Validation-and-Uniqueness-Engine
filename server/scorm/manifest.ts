// Minimal imsmanifest.xml parser tailored for SCORM 1.2 / 2004 packages.
// We only need: schemaversion, organizations/items hierarchy, resources & files.

export interface ScormItem {
  identifier: string;
  title: string;
  identifierref?: string;
  resourceHref?: string | null;
  children: ScormItem[];
}

export interface ScormOrganization {
  identifier: string;
  title: string;
  items: ScormItem[];
}

export interface ScormResource {
  identifier: string;
  type: string;
  scormType?: string;
  href: string | null;
  files: string[];
}

export interface ScormManifest {
  schemaversion: string | null;
  schema: string | null;
  title: string | null;
  defaultOrganizationId: string | null;
  organizations: ScormOrganization[];
  resources: ScormResource[];
}

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function stripNamespace(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w:.-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const key = (m[1] ?? m[3])!;
    const val = m[2] ?? m[4] ?? "";
    out[key] = decodeXml(val);
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Tiny SAX-ish parser; tolerant enough for typical SCORM manifests.
function parseXml(input: string): XmlNode | null {
  let xml = input.replace(/<\?xml[\s\S]*?\?>/g, "");
  xml = xml.replace(/<!--[\s\S]*?-->/g, "");
  xml = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => decodeXml(t));

  const tagRe = /<\/?([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(xml))) {
    const fullTag = m[0];
    const isClosing = fullTag.startsWith("</");
    const name = m[1]!;
    const attrsRaw = m[2] ?? "";
    const selfClosing = m[3] === "/";

    const between = xml.slice(lastIndex, m.index);
    if (between && stack.length) {
      stack[stack.length - 1]!.text += decodeXml(between);
    }
    lastIndex = tagRe.lastIndex;

    if (isClosing) {
      if (stack.length) stack.pop();
      continue;
    }
    const node: XmlNode = { name, attrs: parseAttrs(attrsRaw), children: [], text: "" };
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function findChildren(node: XmlNode, localName: string): XmlNode[] {
  return node.children.filter((c) => stripNamespace(c.name) === localName);
}

function findChild(node: XmlNode, localName: string): XmlNode | undefined {
  return node.children.find((c) => stripNamespace(c.name) === localName);
}

function getAttr(attrs: Record<string, string>, localName: string): string | undefined {
  for (const [k, v] of Object.entries(attrs)) {
    if (stripNamespace(k) === localName) return v;
  }
  return undefined;
}

function readTitle(node: XmlNode): string {
  const t = findChild(node, "title");
  return (t?.text ?? "").trim();
}

function parseItem(node: XmlNode): ScormItem {
  const id = getAttr(node.attrs, "identifier") ?? "";
  const ref = getAttr(node.attrs, "identifierref");
  const title = readTitle(node);
  const children = findChildren(node, "item").map(parseItem);
  return {
    identifier: id,
    title: title || id,
    identifierref: ref,
    children,
  };
}

export function parseManifest(xml: string): ScormManifest {
  const root = parseXml(xml);
  if (!root || stripNamespace(root.name) !== "manifest") {
    throw new Error("imsmanifest.xml missing <manifest> root element");
  }

  const meta = findChild(root, "metadata");
  const schemaversion = meta ? findChild(meta, "schemaversion")?.text.trim() ?? null : null;
  const schema = meta ? findChild(meta, "schema")?.text.trim() ?? null : null;

  const organizationsNode = findChild(root, "organizations");
  const defaultOrganizationId = organizationsNode
    ? getAttr(organizationsNode.attrs, "default") ?? null
    : null;

  const organizations: ScormOrganization[] = organizationsNode
    ? findChildren(organizationsNode, "organization").map((org) => ({
        identifier: getAttr(org.attrs, "identifier") ?? "",
        title: readTitle(org) || "Untitled",
        items: findChildren(org, "item").map(parseItem),
      }))
    : [];

  const resourcesNode = findChild(root, "resources");
  const resources: ScormResource[] = resourcesNode
    ? findChildren(resourcesNode, "resource").map((r) => ({
        identifier: getAttr(r.attrs, "identifier") ?? "",
        type: getAttr(r.attrs, "type") ?? "",
        scormType: getAttr(r.attrs, "scormtype"),
        href: getAttr(r.attrs, "href") ?? null,
        files: findChildren(r, "file")
          .map((f) => getAttr(f.attrs, "href") ?? "")
          .filter(Boolean),
      }))
    : [];

  const title = organizations[0]?.title ?? null;

  return {
    schemaversion,
    schema,
    title,
    defaultOrganizationId,
    organizations,
    resources,
  };
}

export function classifyScormVersion(m: ScormManifest): string {
  const sv = (m.schemaversion ?? "").toLowerCase();
  const sch = (m.schema ?? "").toLowerCase();
  if (sv.includes("1.2") || sch.includes("1.2")) return "SCORM 1.2";
  if (sv.includes("2004") || sch.includes("2004")) {
    if (sv.includes("4th")) return "SCORM 2004 4th Edition";
    if (sv.includes("3rd")) return "SCORM 2004 3rd Edition";
    if (sv.includes("2nd")) return "SCORM 2004 2nd Edition";
    return "SCORM 2004";
  }
  if (sv.includes("cam")) return `SCORM (${sv})`;
  return sv || sch || "Unknown";
}

export function attachResourceHrefs(
  organizations: ScormOrganization[],
  resources: ScormResource[],
): void {
  const byId = new Map(resources.map((r) => [r.identifier, r] as const));
  const walk = (items: ScormItem[]) => {
    for (const it of items) {
      if (it.identifierref) {
        const r = byId.get(it.identifierref);
        it.resourceHref = r?.href ?? null;
      }
      walk(it.children);
    }
  };
  organizations.forEach((o) => walk(o.items));
}
