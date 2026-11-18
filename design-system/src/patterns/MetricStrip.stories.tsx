import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertTriangle, Building2, ClipboardCheck, Users } from "lucide-react";
import { useState } from "react";
import { Select } from "../components/Select";
import { MetricStrip } from "./MetricStrip";

const meta = {
  title: "Patterns/Metric strip",
  component: MetricStrip,
  args: {
    ariaLabel: "Dashboard summary",
    metrics: [
      { id: "entries", title: "Total entries", value: 1284, description: "Up 12% from last month", icon: Users, tone: "success" },
      { id: "unique", title: "Unique visitors", value: 617, description: "Estimated today", icon: Users, tone: "info" },
      { id: "reports", title: "Reports compliance", value: "18 / 24", description: "75% submission rate", icon: ClipboardCheck, tone: "warning" },
      { id: "attention", title: "Needs attention", value: 3, description: "Cameras offline or delayed", icon: AlertTriangle, tone: "danger", showPulse: true },
    ],
  },
} satisfies Meta<typeof MetricStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Grid: Story = { args: { layout: "grid" } };
export const Loading: Story = { args: { metrics: [{ id: "a", title: "Unique visitors", value: null, isLoading: true }, { id: "b", title: "Total entries", value: null, isLoading: true }] } };
export const MissingValue: Story = { args: { metrics: [{ id: "a", title: "Unique visitors", value: null, description: "No camera data yet", tone: "neutral" }] } };
export const Clickable: Story = { args: { metrics: [{ id: "a", title: "Registered enterprises", value: 42, description: "Open the directory", icon: Building2, tone: "teal", onClick: () => undefined }] } };

export const WithControl: Story = {
  render: (args) => {
    const [period, setPeriod] = useState("2026-11");
    return (
      <MetricStrip
        {...args}
        metrics={args.metrics.slice(0, 3)}
        controlSegment={{
          id: "period",
          title: "Reporting period",
          description: "Filter comparative data by calendar month.",
          content: <Select ariaLabel="Reporting period" value={period} onChange={setPeriod} options={[["2026-11", "November 2026"], ["2026-10", "October 2026"]]} />,
        }}
      />
    );
  },
};
