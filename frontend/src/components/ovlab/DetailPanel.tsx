import { useState } from "react";
import { AlertCircle, Loader2, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { api, ApiError } from "@/lib/api";
import { DtoView, type DtoData } from "@/components/ovlab/shared";

export function DetailPanel() {
  const [code, setCode] = useState("");
  const [exps, setExps] = useState("");
  const [data, setData] = useState<DtoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setLoading(true); setErr(null); setData(null);
    try { setData(await api.ovlabDetail(c, exps.trim() || undefined) as DtoData); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "加载失败"); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">标的代码 (prodUnd)</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="如 510300"
            className="w-44 field-input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">合约月份 (可选, 逗号分隔)</label>
          <input
            value={exps}
            onChange={(e) => setExps(e.target.value)}
            placeholder="留空取默认"
            className="w-56 field-input"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          查询
        </button>
      </form>

      {loading ? (
        <EmptyState loading title="加载单品种详情" skeleton="lines" />
      ) : err ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      ) : data ? (
        <DtoView data={data} />
      ) : (
        <EmptyState title="输入标的代码后查询详情" description="支持品种代码或合约代码。" />
      )}
    </div>
  );
}

// —— 异动榜 ——

