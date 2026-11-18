import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, History } from "lucide-react";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { Tabs } from "./Tabs";

const meta = { title: "Components/Tabs and filters", component: Tabs } satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const UnderlineTabs: Story = {
  args: { items: [], value: "create", onChange: () => undefined, ariaLabel: "Reports" },
  render: () => {
    const [value, setValue] = useState("create");
    return (
      <div className="max-w-2xl">
        <Tabs
          ariaLabel="Reports"
          idPrefix="reports"
          value={value}
          onChange={setValue}
          items={[
            { value: "create", label: "Create reports", icon: <FileText size={16} /> },
            { value: "history", label: "Reports history", icon: <History size={16} />, count: 12 },
          ]}
        />
        <div role="tabpanel" id={`reports-panel-${value}`} aria-labelledby={`reports-tab-${value}`} className="p-4 text-sm text-(--tanaw-text-secondary)">
          {value === "create" ? "The monthly report form." : "Every report sent this year."}
        </div>
      </div>
    );
  },
};

export const SegmentedFilter: Story = {
  args: { items: [], value: "", onChange: () => undefined, ariaLabel: "" },
  render: () => {
    const [value, setValue] = useState("attention");
    return (
      <SegmentedControl
        ariaLabel="Work queue"
        value={value}
        onChange={setValue}
        options={[
          { value: "attention", label: "Needs attention", count: 3 },
          { value: "support", label: "Escalated support", count: 1 },
          { value: "accounts", label: "Account requests", count: 0 },
        ]}
      />
    );
  },
};
