import { Link, useLocation } from "wouter";
import { cn } from "../lib/utils";
import { LayoutDashboard, FileText, UploadCloud, GitCompare, Settings } from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/upload", label: "Pre-publish", icon: UploadCloud },
  { to: "/analysis", label: "Analysis", icon: GitCompare },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-slate-200 bg-white">
        <div className="px-6 py-6">
          <div className="text-lg font-semibold text-brand-700">DocuInsight</div>
          <div className="text-xs text-slate-500">Document Intelligence</div>
        </div>
        <nav className="px-3 space-y-1">
          {NAV.map((item) => {
            const active = location === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                href={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-700 hover:bg-slate-100",
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
