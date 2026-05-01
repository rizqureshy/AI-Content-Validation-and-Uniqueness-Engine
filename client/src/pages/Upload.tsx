import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { apiUpload } from "../lib/api";
import { cn, pct } from "../lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown } from "lucide-react";

interface PrePublish {
  novelty: number;
  conflicts: Array<{
    type: string;
    severity: string;
    description: string;
    value1?: string;
    value2?: string;
    matchedDocument: { id: string; name: string };
  }>;
  similarDocuments: Array<{
    document: { id: string; name: string; path: string };
    topSimilarity: number;
    matchedChunks: Array<{
      newChunkText: string;
      existingChunkText: string;
      similarity: number;
      explanation?: string;
    }>;
  }>;
  suggestedLocation: string;
  recommendation: "publish" | "review" | "reject";
  issues: string[];
}

const RECO_STYLE = {
  publish: { icon: CheckCircle2, cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  review: { icon: AlertTriangle, cls: "text-amber-700 bg-amber-50 border-amber-200" },
  reject: { icon: XCircle, cls: "text-rose-700 bg-rose-50 border-rose-200" },
};

export default function Upload() {
  const [result, setResult] = useState<PrePublish | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const check = useMutation({
    mutationFn: (file: File) => apiUpload<PrePublish>("/documents/pre-publish-check", file),
    onSuccess: (data) => setResult(data),
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    onDrop: (files) => {
      if (files[0]) {
        setResult(null);
        check.mutate(files[0]);
      }
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Pre-publish Check</h1>
        <p className="text-sm text-slate-500">
          Upload a draft document to check for duplicates and conflicts before publishing.
        </p>
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
            ? "Drop the file here…"
            : "Drag & drop a PDF / DOCX / PPTX / XLSX / TXT, or click to browse."}
        </p>
        {check.isPending && <p className="mt-2 text-xs text-slate-500">Analyzing…</p>}
        {check.isError && (
          <p className="mt-2 text-xs text-rose-600">{(check.error as Error).message}</p>
        )}
      </div>

      {result && <Verdict result={result} openIdx={openIdx} setOpenIdx={setOpenIdx} />}
    </div>
  );
}

function Verdict({
  result,
  openIdx,
  setOpenIdx,
}: {
  result: PrePublish;
  openIdx: number | null;
  setOpenIdx: (n: number | null) => void;
}) {
  const Style = RECO_STYLE[result.recommendation];
  const Icon = Style.icon;
  return (
    <div className="space-y-4">
      <div className={cn("card border p-5 flex items-start gap-3", Style.cls)}>
        <Icon size={24} />
        <div className="flex-1">
          <div className="font-semibold capitalize">{result.recommendation}</div>
          <ul className="mt-1 text-sm space-y-0.5">
            {result.issues.length === 0 && <li>No issues detected.</li>}
            {result.issues.map((i) => (
              <li key={i}>• {i}</li>
            ))}
          </ul>
          <div className="mt-2 text-xs">
            Novelty: <span className="font-medium">{pct(result.novelty)}</span> · Suggested
            location: <span className="font-mono">{result.suggestedLocation}</span>
          </div>
        </div>
      </div>

      {result.conflicts.length > 0 && (
        <div className="card p-5">
          <div className="font-medium mb-3">Conflicts</div>
          <ul className="space-y-2 text-sm">
            {result.conflicts.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-800"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="badge bg-rose-200 text-rose-900 uppercase">{c.type}</span>
                  <span className="badge bg-rose-200 text-rose-900 uppercase">
                    {c.severity}
                  </span>
                  <span className="text-xs text-rose-700">
                    vs. {c.matchedDocument.name}
                  </span>
                </div>
                <div>{c.description}</div>
                {(c.value1 || c.value2) && (
                  <div className="mt-1 text-xs">
                    <span className="font-mono">{c.value1 ?? "—"}</span>
                    <span className="mx-2 text-rose-500">≠</span>
                    <span className="font-mono">{c.value2 ?? "—"}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="px-5 py-3 border-b font-medium">Similar Documents</div>
        <div className="divide-y divide-slate-100">
          {result.similarDocuments.length === 0 && (
            <div className="px-5 py-4 text-sm text-slate-500">No similar documents found.</div>
          )}
          {result.similarDocuments.map((s, i) => {
            const isOpen = openIdx === i;
            const sevColor =
              s.topSimilarity >= 0.8
                ? "bg-rose-100 text-rose-700"
                : "bg-amber-100 text-amber-700";
            return (
              <div key={s.document.id}>
                <button
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                >
                  <div className="text-left">
                    <div className="text-sm font-medium">{s.document.name}</div>
                    <div className="text-xs text-slate-500">{s.document.path}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("badge", sevColor)}>
                      {pct(s.topSimilarity)} match
                    </span>
                    <ChevronDown
                      size={16}
                      className={cn(
                        "transition-transform",
                        isOpen ? "rotate-180" : "",
                      )}
                    />
                  </div>
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 space-y-3">
                    {s.matchedChunks.map((c, j) => (
                      <div
                        key={j}
                        className="rounded-md border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="text-xs text-slate-500 mb-2">
                          Match {j + 1} · {pct(c.similarity)}
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-xs uppercase text-slate-400 mb-1">
                              New
                            </div>
                            <p className="whitespace-pre-wrap">{c.newChunkText}</p>
                          </div>
                          <div>
                            <div className="text-xs uppercase text-slate-400 mb-1">
                              Existing
                            </div>
                            <p className="whitespace-pre-wrap">{c.existingChunkText}</p>
                          </div>
                        </div>
                        {c.explanation && (
                          <div className="mt-2 text-xs text-slate-600 italic">
                            {c.explanation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
