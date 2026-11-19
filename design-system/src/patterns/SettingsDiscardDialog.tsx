import { ConfirmDialog } from "../components/ConfirmDialog";

export function SettingsDiscardDialog({ onKeepEditing, onDiscard }: { onKeepEditing: () => void; onDiscard: () => void }) {
  return (
    <ConfirmDialog title="Discard unsaved settings?" confirmLabel="Discard changes" cancelLabel="Keep editing" tone="danger" onCancel={onKeepEditing} onConfirm={onDiscard}>
      Your edits will be lost if you leave this section.
    </ConfirmDialog>
  );
}
