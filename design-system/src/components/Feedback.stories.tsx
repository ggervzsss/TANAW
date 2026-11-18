import type { Meta, StoryObj } from "@storybook/react-vite";
import { Users } from "lucide-react";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { ProgressBar } from "./ProgressBar";
import { Skeleton, Spinner } from "./Spinner";

const meta = { title: "Components/Feedback", component: Alert } satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Alerts: Story = {
  render: () => (
    <div className="max-w-2xl space-y-3">
      <Alert tone="info" title="Live updates paused">
        TANAW is reconnecting to live updates automatically.
      </Alert>
      <Alert tone="success" title="Report submitted">
        The November report was sent to the LGU.
      </Alert>
      <Alert tone="warning" title="AI fallback mode is active" action={<Button size="sm" variant="secondary">Details</Button>}>
        Visitor counts may be less accurate.
      </Alert>
      <Alert tone="danger" title="Camera stream unavailable">
        Check the camera's power and network connection.
      </Alert>
    </div>
  ),
};

export const Empty: Story = {
  render: () => <EmptyState icon={<Users size={22} />} title="No LGU accounts" description="Accounts you create appear here." action={<Button>Create account</Button>} />,
};

export const Progress: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <ProgressBar label="Submission rate" value={18} max={24} showValue />
      <ProgressBar label="Storage used" value={92} tone="warning" showValue />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner />
      <Spinner size={24} />
      <div className="space-y-2">
        <Skeleton className="h-10 w-24" label="Loading unique visitors" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  ),
};
