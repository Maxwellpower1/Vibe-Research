import { EmptyState } from "@/components/ui/EmptyState";

/** Shared empty / loading placeholder for Daily Review data panels. */
export function reviewPending(done: boolean, skeleton: "lines" | "table" = "table") {
  return (
    <EmptyState
      loading={!done}
      skeleton={skeleton}
      title="暂无数据"
      description="非交易时段或数据源暂时不可用，可点刷新重试"
    />
  );
}
