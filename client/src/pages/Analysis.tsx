import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { cn, fmtDate } from "../lib/utils";

type Category = "duplicates" | "similar" | "novel" | "conflicts";

interface DocRow {
  id: string;
  name: string;
  path: string;
  modifiedAt: string;
  duplicateCount: number;
  similarCount: number;
  conflictCount: number;
  noveltyScore: number | null;
}

const TABS: { key: Category; label: string }[] = [
  { key: "duplicates", label: "Duplicates" },
  { key: "similar", label: "Similar" },
  { key: "novel", label: "Novel" },
  { key: "conflicts", label: "Conflicts" },
];

export default function Analysis() {
  const [tab, setTab] = useState<Category>("duplicates");
  const q = useQuery({
    queryKey: ["analysis", tab],
    queryFn: () =>
      api<{ data: DocRow[]; total: number }>(
        `/analysis/documents?category=${tab}&limit=200`,
      ),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analysis</h1>
        <p className="text-sm text-slate-500">
          Document-centric view of repository quality.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
              tab === t.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2">Document</th>
              <th className="text-right px-4 py-2">Dup</th>
              <th className="text-right px-4 py-2">Sim</th>
              <th className="text-right px-4 py-2">Conflicts</th>
              <th className="text-right px-4 py-2">Novelty</th>
              <th className="text-left px-4 py-2">Modified</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data?.data?.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-slate-500">{d.path}</div>
                </td>
                <td className="px-4 py-2 text-right">{d.duplicateCount}</td>
                <td className="px-4 py-2 text-right">{d.similarCount}</td>
                <td className="px-4 py-2 text-right">{d.conflictCount}</td>
                <td className="px-4 py-2 text-right">
                  {d.noveltyScore == null ? "—" : (d.noveltyScore * 100).toFixed(0) + "%"}
                </td>
                <td className="px-4 py-2 text-slate-500">{fmtDate(d.modifiedAt)}</td>
              </tr>
            ))}
            {q.data && q.data.data.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                  Nothing in this category yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
