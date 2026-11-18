import type { Meta, StoryObj } from "@storybook/react-vite";
import { Mail } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "./Checkbox";
import { Field } from "./Field";
import { Input, Textarea } from "./Input";
import { SearchField } from "./SearchField";
import { Switch } from "./Switch";

const meta = { title: "Components/Form controls", component: Field } satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TextField: Story = {
  args: { label: "Business email", hint: "We send report reminders here.", required: true, children: <Input type="email" placeholder="name@example.com" /> },
};

export const WithError: Story = {
  args: { label: "Business email", error: "Enter a valid email address.", children: <Input type="email" defaultValue="name@" /> },
};

export const WithLeadingIcon: Story = {
  args: { label: "Recovery email", children: <Input leading={<Mail size={15} />} placeholder="name@example.com" /> },
};

export const Disabled: Story = { args: { label: "Enterprise ID", children: <Input disabled defaultValue="ENT-0042" /> } };

export const SmallInput: Story = { args: { label: "Visitors", children: <Input size="sm" type="number" defaultValue={12} className="w-24 text-right tabular-nums" /> } };

export const Notes: Story = {
  args: { label: "Report notes", hint: "Events, closures or anything that explains the day's counts.", children: <Textarea placeholder="Add notes regarding events, closures, or demographic estimates..." /> },
};

export const Search: Story = {
  args: { label: "Search", children: <span /> },
  render: () => {
    const [value, setValue] = useState("");
    return <SearchField value={value} onChange={setValue} placeholder="Search name or email" className="max-w-sm" />;
  },
};

export const Checkboxes: Story = {
  args: { label: "Options", children: <span /> },
  render: () => (
    <div className="space-y-3">
      <Checkbox label="All from This City" description="Count every visitor today as a resident of this city." defaultChecked />
      <Checkbox label="Include archived reports" />
      <Checkbox label="Unavailable option" disabled />
    </div>
  ),
};

export const Switches: Story = {
  args: { label: "Options", children: <span /> },
  render: () => {
    const [labels, setLabels] = useState(false);
    const [estimates, setEstimates] = useState(true);
    return (
      <div className="max-w-xl divide-y divide-(--tanaw-border-soft)">
        <Switch className="py-4" label="Detection details" description="Show each person's tracker number, tracking state and detection confidence." checked={labels} onChange={setLabels} />
        <Switch className="py-4" label="Male/female estimate" description="Show each person's live estimate. It is never stored." checked={estimates} onChange={setEstimates} />
        <Switch className="py-4" label="Unavailable" checked={false} disabled onChange={() => undefined} />
        <div className="flex items-center justify-between py-4 text-sm font-semibold">
          Label hidden (table row) <Switch hideLabel label="Enable account" checked={estimates} onChange={setEstimates} />
        </div>
      </div>
    );
  },
};
