import { useCallback, useMemo, useState } from "react";

export interface ZoomPanelDef {
  id: string;
  defaultW: number;
  maxZoomW?: number;
}

export interface ZoomRowDef {
  defaultH: number;
  panels: ZoomPanelDef[];
}

export interface PanelLayout {
  rowHeights: number[];
  rowWidths: number[][];
}

export function usePanelZoom(rows: ZoomRowDef[]) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);

  const isZoomed = useCallback((id: string) => zoomedId === id, [zoomedId]);

  const toggle = useCallback((id: string) => {
    setZoomedId((prev) => (prev === id ? null : id));
  }, []);

  const reset = useCallback(() => setZoomedId(null), []);

  const layout = useMemo<PanelLayout>(() => {
    const rowHeights = rows.map((r) => r.defaultH);
    const rowWidths = rows.map((r) => r.panels.map((p) => p.defaultW));

    if (!zoomedId) return { rowHeights, rowWidths };

    let zRow = -1;
    let zIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const idx = rows[i].panels.findIndex((p) => p.id === zoomedId);
      if (idx >= 0) {
        zRow = i;
        zIdx = idx;
        break;
      }
    }
    if (zRow < 0) return { rowHeights, rowWidths };

    const w0 = rows[zRow].panels[zIdx].defaultW;
    const h0 = rows[zRow].defaultH;
    const targetArea = 4 * w0 * h0;
    const wCap = rows[zRow].panels[zIdx].maxZoomW ?? 0.5;

    let w1: number;
    let h1: number;
    if (w0 >= 0.5) {
      w1 = w0;
      h1 = Math.min(targetArea / w0, 0.66);
    } else {
      w1 = Math.min(w0 * 2, wCap);
      h1 = Math.min(targetArea / w1, 0.66);
    }

    const newRowHeights = [...rowHeights];
    newRowHeights[zRow] = h1;
    const remainH = 1 - h1;
    const otherRowsH0 = rowHeights.reduce((s, h, i) => (i === zRow ? s : s + h), 0);
    for (let i = 0; i < rows.length; i++) {
      if (i !== zRow) newRowHeights[i] = (remainH * rowHeights[i]) / otherRowsH0;
    }

    const newRowWidths = rowWidths.map((ws) => [...ws]);
    const remainW = 1 - w1;
    const siblingsW0 = rowWidths[zRow].reduce((s, w, i) => (i === zIdx ? s : s + w), 0);
    newRowWidths[zRow][zIdx] = w1;
    for (let i = 0; i < rowWidths[zRow].length; i++) {
      if (i !== zIdx) newRowWidths[zRow][i] = (remainW * rowWidths[zRow][i]) / siblingsW0;
    }

    return { rowHeights: newRowHeights, rowWidths: newRowWidths };
  }, [rows, zoomedId]);

  return { zoomedId, isZoomed, toggle, reset, layout };
}
