import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { apiUpload } from "../lib/api";
import { cn } from "../lib/utils";
import {
  ChevronRight,
  ChevronDown,
  Stethoscope,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Code as CodeIcon,
  HardDrive,
  Link2,
} from "lucide-react";

interface ItemReport {
  identifier: string;
  title: string;
  resourceHref: string | null;
  wordCount: number;
  urlCount: number;
  externalUrlCount: number;
  brokenLinkCount: number;
  children: ItemReport[];
}

interface ExternalUrlEntry {
  url: string;
  occurrences: number;
  firstSeenIn: string;
  attributes: string[];
  health?: {
    ok: boolean;
    status: number | null;
    statusText?: string;
    redirectedTo?: string;
    responseTimeMs: number;
    method: "HEAD" | "GET" | null;
    error?: string;
  };
}

interface InternalIssue {
  fromFile: string;
  href: string;
  resolved: string;
}

interface AssetSummary {
  totalFiles: number;
  totalBytes: number;
  byGroup: Record<string, { count: number; bytes: number }>;
  byExt: Record<string, number>;
  largestFiles: Array<{ path: string; bytes: number }>;
}

interface ScormReport {
  filename: string;
  sizeBytes: number;
  scormVersion: string;
  packageType: string;
  detectedAuthoringTool: string | null;
  title: string;
  defaultOrganization: string | null;
  manifest: {
    schemaversion: string | null;
    schema: string | null;
    organizationCount: number;
    resourceCount: number;
  };
  organizations: Array<{ identifier: string; title: string; items: ItemReport[] }>;
  resources: Array<{
    identifier: string;
    type: string;
    scormType?: string;
    href: string | null;
    files: string[];
  }>;
  assets: AssetSummary;
  totals: {
    items: number;
    htmlPages: number;
    wordCount: number;
    externalUrls: number;
    internalLinks: number;
    brokenInternalLinks: number;
  };
  externalUrls: ExternalUrlEntry[];
  internalIssues: InternalIssue[];
  warnings: string[];
  durationEstimateMinutes: number;
  generatedAt: string;
  urlHealth: { checked: boolean; ok: number; broken: number; skipped: number };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

const GROUP_ICON: Record<string, typeof FileText> = {
  html: FileText,
  script: CodeIcon,
  style: CodeIcon,
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  data: CodeIcon,
  font: FileText,
  captions: FileText,
  other: HardDrive,
};

export default function ScormDoctor() {
  const [report, setReport] = useState<ScormReport | null>(null);
  const [tab, setTab] = useState<"outline" | "urls" | "assets" | "resources">("outline");

  const analyze = useMutation({
    mutationFn: (file: File) => apiUpload<ScormReport>("/scorm/analyze", file),
    onSuccess: setReport,
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    accept: { "application/zip": [".zip"], "application/x-zip-compressed": [".zip"] },
    onDrop: (files) => {
      if (files[0]) {
        setReport(null);
        analyze.mutate(files[0]);
      }
    },
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Stethoscope size={28} className="text-brand-600" />
        <div>
          <h1 className="text-2xl font-semibold">SCORM Doctor</h1>
          <p className="text-sm text-slate-500">
            Upload a SCORM 1.2 / 2004 package — built with Articulate Rise, Storyline, Captivate or
            anything else — and get a full breakdown of structure, content, links, and asset health.
          </p>
        </div>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "card p-10 text-center cursor-pointer border-2 border-dashed",
          isDragActive ? "border-brand-500 bg-brand-50" : "border-slate-300",
        )}
      >
        <input {...getInputProps()} />
        <p className="text-sm text-slate-600">
          {isDragActive
            ? "Drop the SCORM .zip here…"
            : "Drag & drop a SCORM .zip, or click to browse. Up to 500 MB."}
        </p>
        {analyze.isPending && (
          <p className="mt-2 text-xs text-slate-500">
            Unpacking, scanning HTML, probing external URLs… this can take a moment.
          </p>
        )}
        {analyze.isError && (
          <p className="mt-2 text-xs text-rose-600">{(analyze.error as Error).message}</p>
        )}
      </div>

      {report && (
        <>
          <Summary report={report} />

          {report.warnings.length > 0 && (
            <div className="card border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 font-medium text-amber-800">
                <AlertTriangle size={16} /> Warnings
              </div>
              <ul className="mt-2 text-sm text-amber-800 space-y-1">
                {report.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-b border-slate-200 flex gap-6 text-sm">
            {(
              [
                ["outline", "Course Outline"],
                ["urls", `External URLs (${report.totals.externalUrls})`],
                ["assets", "Assets"],
                ["resources", `Resources (${report.manifest.resourceCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "py-2 -mb-px border-b-2 font-medium transition-colors",
                  tab === key
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-800",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "outline" && <Outline report={report} />}
          {tab === "urls" && <UrlsPanel report={report} />}
          {tab === "assets" && <AssetsPanel report={report} />}
          {tab === "resources" && <ResourcesPanel report={report} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Summary({ report }: { report: ScormReport }) {
  const brokenExternal = report.externalUrls.filter(
    (u) => u.health && !u.health.ok,
  ).length;
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {report.filename}
            </div>
            <div className="mt-1 text-xl font-semibold">{report.title}</div>
            <div className="text-sm text-slate-500 mt-1">
              {report.packageType} · {formatBytes(report.sizeBytes)}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>Schema: {report.manifest.schemaversion ?? "—"}</div>
            <div>Schema URL: {report.manifest.schema ?? "—"}</div>
            <div>Default org: {report.defaultOrganization ?? "—"}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Items" value={report.totals.items.toString()} />
        <Stat label="HTML pages" value={report.totals.htmlPages.toString()} />
        <Stat
          label="Words"
          value={report.totals.wordCount.toLocaleString()}
          sub={`~${report.durationEstimateMinutes} min reading`}
        />
        <Stat
          label="External URLs"
          value={report.totals.externalUrls.toString()}
          sub={
            report.urlHealth.checked
              ? `${report.urlHealth.ok} ok · ${brokenExternal} broken`
              : "not checked"
          }
        />
        <Stat
          label="Broken internal links"
          value={report.totals.brokenInternalLinks.toString()}
        />
        <Stat label="Resources" value={report.manifest.resourceCount.toString()} />
        <Stat label="Files" value={report.assets.totalFiles.toString()} />
        <Stat label="Total size" value={formatBytes(report.assets.totalBytes)} />
      </div>
    </div>
  );
}

function Outline({ report }: { report: ScormReport }) {
  return (
    <div className="space-y-4">
      {report.organizations.map((org) => (
        <div key={org.identifier} className="card">
          <div className="px-5 py-3 border-b font-medium flex items-center gap-2">
            <FileText size={16} className="text-brand-600" /> {org.title}
          </div>
          <div className="p-2">
            {org.items.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">No items declared.</div>
            ) : (
              org.items.map((it) => <OutlineNode key={it.identifier} item={it} depth={0} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OutlineNode({ item, depth }: { item: ItemReport; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = item.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-slate-50"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <button
          className="text-slate-400 hover:text-slate-700 disabled:invisible"
          disabled={!hasChildren}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="font-medium text-slate-800">{item.title}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          {item.wordCount > 0 && <span>{item.wordCount.toLocaleString()} words</span>}
          {item.externalUrlCount > 0 && (
            <span className="badge bg-slate-100 text-slate-700">
              <Globe size={10} className="mr-1" /> {item.externalUrlCount}
            </span>
          )}
          {item.brokenLinkCount > 0 && (
            <span className="badge bg-rose-100 text-rose-700">
              {item.brokenLinkCount} broken
            </span>
          )}
          {item.resourceHref && (
            <span className="font-mono text-[10px] text-slate-400 truncate max-w-[24ch]">
              {item.resourceHref}
            </span>
          )}
        </span>
      </div>
      {open &&
        hasChildren &&
        item.children.map((c) => <OutlineNode key={c.identifier} item={c} depth={depth + 1} />)}
    </div>
  );
}

function UrlsPanel({ report }: { report: ScormReport }) {
  const [filter, setFilter] = useState<"all" | "broken" | "ok">("all");
  const filtered = useMemo(() => {
    if (filter === "all") return report.externalUrls;
    return report.externalUrls.filter((u) => {
      if (!u.health) return false;
      return filter === "broken" ? !u.health.ok : u.health.ok;
    });
  }, [filter, report.externalUrls]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(["all", "ok", "broken"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              "btn",
              filter === k
                ? "bg-brand-600 text-white hover:bg-brand-700"
                : "btn-secondary",
            )}
          >
            {k === "all" ? "All" : k === "ok" ? "Healthy" : "Broken / unreachable"}
          </button>
        ))}
        {!report.urlHealth.checked && (
          <span className="text-xs text-slate-500 ml-auto">URL health checks were skipped.</span>
        )}
        {report.urlHealth.skipped > 0 && (
          <span className="text-xs text-slate-500 ml-auto">
            {report.urlHealth.skipped} URLs not checked (cap reached).
          </span>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">URL</th>
              <th className="text-left px-4 py-2">Where</th>
              <th className="text-right px-4 py-2">Hits</th>
              <th className="text-right px-4 py-2">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No URLs match this filter.
                </td>
              </tr>
            )}
            {filtered.map((u) => (
              <tr key={u.url} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <HealthBadge entry={u} />
                </td>
                <td className="px-4 py-2 font-mono text-xs break-all">
                  <a
                    href={u.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand-700 hover:underline"
                  >
                    {u.url}
                  </a>
                  {u.health?.redirectedTo && u.health.redirectedTo !== u.url && (
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      → {u.health.redirectedTo}
                    </div>
                  )}
                  {u.health?.error && (
                    <div className="text-[10px] text-rose-600 mt-0.5">{u.health.error}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  <div className="font-mono truncate max-w-[28ch]">{u.firstSeenIn}</div>
                  <div className="text-[10px] text-slate-400">{u.attributes.join(", ")}</div>
                </td>
                <td className="px-4 py-2 text-right">{u.occurrences}</td>
                <td className="px-4 py-2 text-right text-xs text-slate-500">
                  {u.health ? `${u.health.responseTimeMs} ms` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.internalIssues.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b font-medium flex items-center gap-2">
            <Link2 size={16} className="text-rose-600" />
            Broken internal links ({report.internalIssues.length})
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {report.internalIssues.slice(0, 200).map((i, idx) => (
              <li key={idx} className="px-5 py-2">
                <div className="font-mono text-xs">{i.href}</div>
                <div className="text-xs text-slate-500">
                  in <span className="font-mono">{i.fromFile}</span> → resolved to{" "}
                  <span className="font-mono">{i.resolved}</span> (not in package)
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HealthBadge({ entry }: { entry: ExternalUrlEntry }) {
  if (!entry.health) {
    return <span className="badge bg-slate-100 text-slate-600">unchecked</span>;
  }
  if (entry.health.ok) {
    return (
      <span className="badge bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
        <CheckCircle2 size={12} /> {entry.health.status}
      </span>
    );
  }
  return (
    <span className="badge bg-rose-100 text-rose-700 inline-flex items-center gap-1">
      <XCircle size={12} />
      {entry.health.status ?? "ERR"}
    </span>
  );
}

function AssetsPanel({ report }: { report: ScormReport }) {
  const groups = Object.entries(report.assets.byGroup).sort(
    (a, b) => b[1].bytes - a[1].bytes,
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {groups.map(([group, info]) => {
          const Icon = GROUP_ICON[group] ?? HardDrive;
          return (
            <div key={group} className="card p-4">
              <div className="flex items-center gap-2 text-slate-700">
                <Icon size={16} className="text-brand-600" />
                <span className="font-medium capitalize">{group}</span>
              </div>
              <div className="mt-2 text-xl font-semibold">{info.count}</div>
              <div className="text-xs text-slate-500">{formatBytes(info.bytes)}</div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b font-medium">Largest files</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {report.assets.largestFiles.map((f) => (
              <tr key={f.path}>
                <td className="px-5 py-2 font-mono text-xs break-all">{f.path}</td>
                <td className="px-5 py-2 text-right text-slate-500 whitespace-nowrap">
                  {formatBytes(f.bytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b font-medium">By extension</div>
        <div className="p-4 flex flex-wrap gap-2">
          {Object.entries(report.assets.byExt)
            .sort((a, b) => b[1] - a[1])
            .map(([ext, count]) => (
              <span key={ext} className="badge bg-slate-100 text-slate-700">
                .{ext} · {count}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

function ResourcesPanel({ report }: { report: ScormReport }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
          <tr>
            <th className="text-left px-4 py-2">Identifier</th>
            <th className="text-left px-4 py-2">Type</th>
            <th className="text-left px-4 py-2">SCORM Type</th>
            <th className="text-left px-4 py-2">Entry HREF</th>
            <th className="text-right px-4 py-2">Files</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {report.resources.map((r) => (
            <tr key={r.identifier} className="hover:bg-slate-50">
              <td className="px-4 py-2 font-mono text-xs">{r.identifier}</td>
              <td className="px-4 py-2 text-xs">{r.type}</td>
              <td className="px-4 py-2 text-xs">{r.scormType ?? "—"}</td>
              <td className="px-4 py-2 font-mono text-xs break-all">{r.href ?? "—"}</td>
              <td className="px-4 py-2 text-right">{r.files.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
