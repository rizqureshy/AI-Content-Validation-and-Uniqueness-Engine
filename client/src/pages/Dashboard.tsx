import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtDate } from "../lib/utils";

interface Health {
  totalDocuments: number;
  duplicatePairs: number;
  similarPairs: number;
  novelDocuments: number;
  unresolvedConflicts: number;
}

interface DocRow {
  id: string;
  name: string;
  path: string;
  modifiedAt: string;
  duplicateCount: number;
  similarCount: number;
  conflictCount: number;
}

export default function Dashboard() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
  });
  const recent = useQuery({
    queryKey: ["recent-docs"],
    queryFn: () => api<{ data: DocRow[] }>("/documents/recent"),
  });

  const stats = [
    { label: "Total Documents", value: health.data?.totalDocuments ?? "—" },
    { label: "Duplicate Pairs", value: health.data?.duplicatePairs ?? "—" },
    { label: "Similar Pairs", value: health.data?.similarPairs ?? "—" },
    { label: "Novel Documents", value: health.data?.novelDocuments ?? "—" },
    { label: "Open Conflicts", value: health.data?.unresolvedConflicts ?? "—" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Repository Health</h1>
        <p className="text-sm text-slate-500">
          AI-powered overview of your document repository's quality.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{s.value}</div>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="px-5 py-3 border-b border-slate-200 font-medium">Recent Documents</div>
        <div className="divide-y divide-slate-100">
          {recent.data?.data?.map((d) => (
            <div key={d.id} className="px-5 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{d.name}</div>
                <div className="text-xs text-slate-500 truncate">{d.path}</div>
              </div>
              <div className="flex gap-2 text-xs">
                {d.duplicateCount > 0 && (
                  <span className="badge bg-red-100 text-red-700">
                    {d.duplicateCount} dup
                  </span>
                )}
                {d.similarCount > 0 && (
                  <span className="badge bg-amber-100 text-amber-700">
                    {d.similarCount} sim
                  </span>
                )}
                {d.conflictCount > 0 && (
                  <span className="badge bg-rose-100 text-rose-700">
                    {d.conflictCount} conflict
                  </span>
                )}
                <span className="text-slate-400">{fmtDate(d.modifiedAt)}</span>
              </div>
            </div>
          )) ?? <div className="px-5 py-6 text-sm text-slate-500">No documents yet.</div>}
        </div>
      </section>
    </div>
  );
}
