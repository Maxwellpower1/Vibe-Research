import type { ReactNode } from "react";

export function AsyncContent({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading && !error) {
    return <div className="flex h-full items-center justify-center text-[11px] text-slate-600">加载中…</div>;
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[11px] text-red-400">
        <span>数据异常: {error}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 hover:bg-slate-700/50">
            重试
          </button>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
