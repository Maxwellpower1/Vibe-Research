import { Navigate, useSearchParams } from "react-router-dom";

/** Legacy /stock-data?code=xxx → /a-share?tab=kline&code=xxx */
export function StockDataRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams();
  next.set("tab", "kline");
  const code = params.get("code");
  if (code) next.set("code", code);
  return <Navigate to={`/a-share?${next.toString()}`} replace />;
}
