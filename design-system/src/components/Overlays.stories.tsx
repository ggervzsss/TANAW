import type { Meta, StoryObj } from "@storybook/react-vite";
import { Info, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { DetailList } from "./DetailField";
import { Dialog } from "./Dialog";
import { Tooltip } from "./Tooltip";

const meta = { title: "Components/Dialogs and tooltips", component: Dialog } satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const placeholderArgs = { title: "", children: null, onClose: () => undefined };

export const DetailDialog: Story = {
  args: placeholderArgs,
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open ticket details
        </Button>
        {open && (
          <Dialog
            eyebrow="TCK-0192"
            title="Camera offline at the plaza"
            description="Reported by Plaza Hotel on 18 November 2026."
            accent="thread"
            size="lg"
            onClose={() => setOpen(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button>Start work</Button>
              </>
            }
          >
            <DetailList
              items={[
                { label: "Status", value: "Open" },
                { label: "Priority", value: "High" },
                { label: "Camera", value: "Plaza camera" },
                { label: "Affected area", value: "Main entrance" },
              ]}
            />
          </Dialog>
        )}
      </>
    );
  },
};

export const DangerConfirmation: Story = {
  args: placeholderArgs,
  render: () => {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return (
      <>
        <Button variant="danger" leadingIcon={<Trash2 size={16} />} onClick={() => setOpen(true)}>
          Delete camera
        </Button>
        {open && (
          <ConfirmDialog
            tone="danger"
            title="Delete Plaza camera?"
            confirmLabel="Delete camera"
            busy={busy}
            onCancel={() => setOpen(false)}
            onConfirm={() => {
              setBusy(true);
              window.setTimeout(() => {
                setBusy(false);
                setOpen(false);
              }, 1200);
            }}
          >
            Its settings and saved stream address are removed. Counts already saved in reports stay. This cannot be undone.
          </ConfirmDialog>
        )}
      </>
    );
  },
};

export const InfoTooltip: Story = {
  args: placeholderArgs,
  render: () => (
    <p className="flex items-center gap-2 pt-16 text-sm font-semibold">
      Unique visitors
      <Tooltip content="People counted once per day across every camera at this establishment." ariaLabel="About unique visitors">
        <Info size={15} className="text-(--tanaw-text-muted)" />
      </Tooltip>
    </p>
  ),
};
