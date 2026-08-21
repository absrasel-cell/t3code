import { CloudIcon, TerminalSquareIcon } from "lucide-react";

import { BUILDER_ENVIRONMENT } from "../builderEnvironment.runtime";

export function RemoteBuilderStatus() {
  if (!BUILDER_ENVIRONMENT.isRemote) {
    return null;
  }

  return (
    <aside
      aria-label="Remote builder status"
      className="mx-1 mb-1 rounded-lg border border-border/70 bg-muted/25 px-2.5 py-2"
    >
      <div className="flex items-start gap-2">
        <CloudIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-foreground">RedClaw workspace</p>
            <span className="shrink-0 text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
              Remote
            </span>
          </div>
          <div className="mt-1 flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
            <TerminalSquareIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>Terminal locked pending server-attested sandbox access.</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
