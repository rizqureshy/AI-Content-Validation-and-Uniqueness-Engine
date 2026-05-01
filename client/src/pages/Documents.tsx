import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtDate } from "../lib/utils";
import { RefreshCw, Play } from "lucide-react";

interface DocRow {
  id: string;
  name: string;
  path: string;
  size: number | null;
  mimeType: string | null;
  modifiedAt: string;
  analyzedAt: string | null;
  chunkCount: number;
  duplicateCount: number;
  similarCount: number;
  conflictCount: number;
}

export default function Documents() {
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: ["docs"],
    queryFn: () => api<{ data: DocRow[] }>("/documents?limit=200"),
  });

  const sync = useMutation({
    mutationFn: () => api("/sharepoint/sync", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs"] }),
  });
  const runAll = useMutation({
    mutationFn: () => api("/analysis/run", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs"] }),
  });
  const analyzeOne = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/analyze`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-slate-500">Synced from SharePoint and ready for analysis.</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCw size={16} /> Sync SharePoint
          </button>
          <button
            className="btn-primary"
            onClick={() => runAll.mutate()}
            disabled={runAll.isPending}
          >
            <Play size={16} /> Analyze All
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Path</th>
              <th className="text-right px-4 py-2">Chunks</th>
              <th className="text-right px-4 py-2">Dup</th>
              <th className="text-right px-4 py-2">Sim</th>
              <th className="text-right px-4 py-2">Conflicts</th>
              <th className="text-left px-4 py-2">Analyzed</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docs.data?.data?.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{d.name}</td>
                <td className="px-4 py-2 text-slate-500 truncate max-w-xs">{d.path}</td>
                <td className="px-4 py-2 text-right">{d.chunkCount}</td>
                <td className="px-4 py-2 text-right">{d.duplicateCount}</td>
                <td className="px-4 py-2 text-right">{d.similarCount}</td>
                <td className="px-4 py-2 text-right">{d.conflictCount}</td>
                <td className="px-4 py-2 text-slate-500">{fmtDate(d.analyzedAt)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    className="btn-secondary !py-1 !px-2"
                    onClick={() => analyzeOne.mutate(d.id)}
                    disabled={analyzeOne.isPending}
                  >
                    Analyze
                  </button>
                </td>
              </tr>
            ))}
            {docs.data?.data?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={8}>
                  No documents — run a SharePoint sync to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
