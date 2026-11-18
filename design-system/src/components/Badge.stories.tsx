import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import { StatusDot } from "./StatusDot";

const meta = {
  title: "Components/Badge",
  component: Badge,
  args: { children: "In Review", tone: "warning" },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

/** "In Review" is shown as "In review": badges are sentence case. */
export const Default: Story = {};

export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge tone="success">Resolved</Badge>
      <Badge tone="warning">Pending review</Badge>
      <Badge tone="danger">Returned for revision</Badge>
      <Badge tone="info">Open</Badge>
      <Badge tone="neutral">Archived</Badge>
      <Badge tone="teal">Ready to consolidate</Badge>
      <Badge tone="purple">Admin monitoring</Badge>
    </div>
  ),
};

export const LiveDot: Story = { args: { tone: "success", dot: "pulse", children: "running" } };
export const Small: Story = { args: { size: "sm", tone: "success", children: "Ownership verified" } };
export const Square: Story = { args: { shape: "square", tone: "info", children: "REP-202607", sentenceCase: false } };
export const Counter: Story = { args: { tone: "warning", children: "5 unavailable" } };

export const StatusDots: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-sm">
      <span className="flex items-center gap-2">
        <StatusDot tone="live" pulse /> Running
      </span>
      <span className="flex items-center gap-2">
        <StatusDot tone="warning" /> Partial
      </span>
      <span className="flex items-center gap-2">
        <StatusDot tone="neutral" /> Stopped
      </span>
      <span className="flex items-center gap-2">
        <StatusDot tone="danger" /> Fault
      </span>
    </div>
  ),
};
