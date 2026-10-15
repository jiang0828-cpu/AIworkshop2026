"use client";
import { useEffect, useState, type ReactNode } from "react";

export default function VisionContent({ title, preview, focused = false, children }: { title: string; preview: string; focused?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(focused);
  useEffect(() => { if (focused) setExpanded(true); }, [focused]);
  return <div className="mt-3">
    {!expanded && <p className="mb-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-500">{preview}</p>}
    <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer py-1 text-xs text-sage focus-visible:outline focus-visible:outline-2 focus-visible:outline-sage">{expanded ? "收起" : "展开"}{title}</summary>
      {children}
    </details>
  </div>;
}
