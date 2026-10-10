import type { Ref } from "react";

export function AuthStageGlow({ cursorRef }: { cursorRef: Ref<HTMLDivElement> }) {
  return (
    <div className="tanaw-stage-glow absolute inset-0" aria-hidden="true">
      <div ref={cursorRef} className="tanaw-stage-glow__cursor" />
    </div>
  );
}
