import { useEffect, useState } from "react";
import { DESKTOP_BACKUP_RESTORED_EVENT } from "../services/local-backup";

/** Counts restores from the server backup, so effects that load local data can load it again. */
export function useBackupRestoreGeneration() {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const handleRestore = () => setGeneration((value) => value + 1);
    window.addEventListener(DESKTOP_BACKUP_RESTORED_EVENT, handleRestore);
    return () => window.removeEventListener(DESKTOP_BACKUP_RESTORED_EVENT, handleRestore);
  }, []);
  return generation;
}
