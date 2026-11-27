import { ArrowRight } from "lucide-react";
import { Spinner } from "../../../ui-kit";

/**
 * The arrow at the end of a sign-in action. It steps forward on hover (login.css); while the action
 * runs, a spinner takes its place in the same slot, so the button keeps its size and nothing shifts.
 */
export function AuthActionTrail({ busy = false }: { busy?: boolean }) {
  return (
    <span className="tanaw-auth-action-trail" aria-hidden="true">
      {busy ? <Spinner key="busy" size={16} label="" /> : <ArrowRight key="idle" className="h-4.5 w-4.5" strokeWidth={2.1} />}
    </span>
  );
}
