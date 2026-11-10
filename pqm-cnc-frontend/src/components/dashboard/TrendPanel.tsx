import type { ReactNode } from "react";
import { Panel } from "./Panel";

/** Shared panel sizing and content flow for quality and tool-wear trends. */
export function TrendPanel({ id, title, status, controls, description, children }: {
  id: string;
  title: string;
  status?: ReactNode;
  controls?: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel id={id} title={title} titleRight={status} className="h-full" bodyClassName="gap-1 p-2.5">
      {controls}
      <p className="shrink-0 text-[10px] leading-snug text-[#6b7c8f]">{description}</p>
      {children}
    </Panel>
  );
}
