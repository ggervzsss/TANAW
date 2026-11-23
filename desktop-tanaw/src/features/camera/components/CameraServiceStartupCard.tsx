import { useState } from "react";
import { Alert, Button, ConfirmDialog } from "../../../ui-kit";

type CameraServiceStartupCardProps = {
  /** Why the camera service could not start for this establishment, or null while it starts. */
  error: string | null;
  /** The local data was saved by an earlier version that this one cannot open. */
  resetRequired: boolean;
  onRetry: () => void;
  /** Sets the unreadable local data aside; the card retries once it resolves. */
  onResetLocalData: () => Promise<void>;
};

export function CameraServiceStartupCard({ error, resetRequired, onRetry, onResetLocalData }: CameraServiceStartupCardProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const resetLocalData = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await onResetLocalData();
      setConfirmingReset(false);
    } catch (resetFailure) {
      setConfirmingReset(false);
      setResetError(resetFailure instanceof Error ? resetFailure.message : "TANAW could not reset the local data.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="mx-auto mt-8 max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900" role={error ? "alert" : "status"}>
      <h2 className="font-semibold">{resetRequired ? "Local data needs a reset" : error ? "Camera service unavailable" : "Starting the local camera service"}</h2>
      {resetRequired ? (
        <>
          <p className="mt-2 text-sm">This version of TANAW cannot open the data that an earlier version saved on this computer.</p>
          <p className="mt-2 text-sm text-(--tanaw-text-secondary)">
            Resetting sets that data aside and starts fresh. If a server backup exists, your unsubmitted counts, report drafts and camera settings come back from it. Reports you already submitted are safe on the server.
          </p>
          {resetError && (
            <Alert tone="danger" className="mt-4">
              {resetError}
            </Alert>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => setConfirmingReset(true)}>Reset local data</Button>
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </>
      ) : (
        error && (
          <>
            <p className="mt-2 text-sm wrap-break-word">{error}</p>
            <Button className="mt-4" onClick={onRetry}>
              Try again
            </Button>
          </>
        )
      )}
      {confirmingReset && (
        <ConfirmDialog title="Reset local data?" confirmLabel="Reset local data" tone="danger" busy={resetting} onCancel={() => setConfirmingReset(false)} onConfirm={() => void resetLocalData()}>
          <p>TANAW will move the unreadable data aside on this computer and start with empty local data.</p>
          <p className="mt-2">Anything newer than the last server backup, usually under an hour of counts, will not come back. Camera usernames and passwords saved on this computer are kept.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
