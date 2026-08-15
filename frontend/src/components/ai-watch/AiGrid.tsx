import { memo, useState, type ComponentType } from "react";
import { type PanelZoomProps } from "@/components/cockpit/Panel";

type PanelCompProps = { className?: string } & PanelZoomProps;

export interface AiCellDef {
  id: string;
  component: ComponentType<PanelCompProps>;
  area: string;
  mobileH: string;
}

const MemoCell = memo(function MemoCell({
  component: C,
  ...props
}: { component: ComponentType<PanelCompProps> } & PanelCompProps) {
  return <C {...props} />;
});

export function AiGrid({ cells }: { cells: AiCellDef[] }) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const toggle = (id: string) => setZoomedId((p) => (p === id ? null : id));
  const zoomed = zoomedId != null;

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 gap-1 overflow-y-auto p-1 lg:grid-cols-3 lg:grid-rows-4 lg:overflow-hidden">
      {cells.map((c) => (
        <div
          key={c.id}
          className={`min-h-0 transition-all duration-300 ${c.mobileH} lg:h-full ${
            zoomed
              ? zoomedId === c.id
                ? "z-10 lg:col-start-1 lg:row-start-1 lg:col-span-3 lg:row-span-4"
                : "hidden"
              : c.area
          }`}
        >
          <MemoCell
            component={c.component}
            className="h-full"
            panelId={c.id}
            isZoomed={zoomedId === c.id}
            onToggleZoom={toggle}
          />
        </div>
      ))}
    </main>
  );
}
