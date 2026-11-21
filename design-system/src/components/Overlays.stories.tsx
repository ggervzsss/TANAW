import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";
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

function DetailDialogDemo({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
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
}

function DangerConfirmationDemo({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
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
}

export const DetailDialog: Story = { args: placeholderArgs, render: () => <DetailDialogDemo /> };

export const DangerConfirmation: Story = { args: placeholderArgs, render: () => <DangerConfirmationDemo /> };

/*
 * Open states. Dialogs and tooltips render under document.body, outside #storybook-root, so the
 * accessibility sweep (scripts/a11y-sweep.mjs) waits for the overlay named by each a11y-open-* tag
 * and scans its portal content as well.
 */
export const DetailDialogOpen: Story = { args: placeholderArgs, tags: ["a11y-open-dialog"], render: () => <DetailDialogDemo initiallyOpen /> };

export const DangerConfirmationOpen: Story = { args: placeholderArgs, tags: ["a11y-open-dialog"], render: () => <DangerConfirmationDemo initiallyOpen /> };

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

export const InfoTooltipOpen: Story = {
  ...InfoTooltip,
  tags: ["a11y-open-tooltip"],
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole("button", { name: "About unique visitors" }).focus();
    await within(canvasElement.ownerDocument.body).findByRole("tooltip");
  },
};
