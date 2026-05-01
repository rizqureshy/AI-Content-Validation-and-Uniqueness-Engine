import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { CheckCircle2, XCircle } from "lucide-react";

interface Status {
  sharepoint: { configured: boolean; connected: boolean };
  cohere: { configured: boolean };
  openai: { configured: boolean };
}

export default function Settings() {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: () => api<Status>("/settings/status"),
  });

  const items = [
    { label: "SharePoint", ok: data?.sharepoint.connected ?? false, sub: data?.sharepoint.configured ? "Configured" : "Missing credentials" },
    { label: "Cohere Embed 4", ok: data?.cohere.configured ?? false, sub: data?.cohere.configured ? "API key present" : "Missing COHERE_API_KEY" },
    { label: "OpenAI GPT-4o", ok: data?.openai.configured ?? false, sub: data?.openai.configured ? "API key present" : "Missing OPENAI_API_KEY" },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">Connection status for integrated services.</p>
      </div>
      <div className="card divide-y divide-slate-100">
        {items.map((i) => (
          <div key={i.label} className="px-5 py-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{i.label}</div>
              <div className="text-xs text-slate-500">{i.sub}</div>
            </div>
            <div
              className={cn(
                "flex items-center gap-2 text-sm font-medium",
                i.ok ? "text-emerald-700" : "text-rose-700",
              )}
            >
              {i.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              {i.ok ? "Connected" : "Not connected"}
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5 text-sm space-y-2 text-slate-600">
        <div className="font-medium text-slate-900">Required environment variables</div>
        <ul className="font-mono text-xs space-y-1">
          <li>DATABASE_URL</li>
          <li>COHERE_API_KEY</li>
          <li>OPENAI_API_KEY</li>
          <li>MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET</li>
          <li>MS_SHAREPOINT_HOSTNAME, MS_SHAREPOINT_SITE</li>
        </ul>
      </div>
    </div>
  );
}
