import { ExpiryCalendar } from "@/components/ovlab/ExpiryCalendar";
import type { DerivData } from "@/hooks/useDerivData";
import { CellEmpty } from "./derivShared";

/** 临期期权月历: 同帧 product-exps, 当前查看月且未过期, 格子标交易所, 点/悬停看标的. */
export function ExpiryCalPanel({ d }: { d: DerivData }) {
  if (!d.exps) return <CellEmpty text="更新中…" />;
  if (d.exps.length === 0) return <CellEmpty text="暂无到期数据" />;
  return (
    <div className="h-full min-h-0">
      <ExpiryCalendar data={d.exps} />
    </div>
  );
}
