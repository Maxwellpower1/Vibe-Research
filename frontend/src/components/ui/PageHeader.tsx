import { type ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/40 pb-2">
      <div className="min-w-0">
        <h1 className="text-[15px] font-bold tracking-wide text-slate-100">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
