/*
 * GENERATED FILE. Do not edit; change design-system/src/patterns/SettingsDiscardDialog.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 6eaba300e697432d405c514cec73911275f97f6606fb023c19909abb59bcfe6c
 */
import { ConfirmDialog } from "../components/ConfirmDialog";

export function SettingsDiscardDialog({ onKeepEditing, onDiscard }: { onKeepEditing: () => void; onDiscard: () => void }) {
  return (
    <ConfirmDialog title="Discard unsaved settings?" confirmLabel="Discard changes" cancelLabel="Keep editing" tone="danger" onCancel={onKeepEditing} onConfirm={onDiscard}>
      Your edits will be lost if you leave this section.
    </ConfirmDialog>
  );
}
