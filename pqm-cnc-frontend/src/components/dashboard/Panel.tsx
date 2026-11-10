import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/format";
import { panelBody, panelClass, panelHeader, panelTitle } from "./opsStyles";

export function Panel({
  title,
  titleRight,
  children,
  className,
  id,
  bodyClassName,
  bodyStyle,
}: {
  title: string;
  titleRight?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
}) {
  return (
    <section
      id={id}
      className={cn(panelClass, "flex h-full min-h-0 flex-col", className)}
    >
      <div className={cn(panelHeader, "shrink-0")}>
        <h2 className={panelTitle}>{title}</h2>
        {titleRight}
      </div>
      <div className={cn(panelBody, "min-h-0 flex-1 overflow-auto", bodyClassName)} style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}
