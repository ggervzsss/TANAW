import type { Meta, StoryObj } from "@storybook/react-vite";
import { Camera } from "lucide-react";
import { Button } from "./Button";
import { Card, CardFooter, CardHeader } from "./Card";
import { SectionLabel } from "./SectionLabel";

const meta = {
  title: "Components/Card",
  component: Card,
  args: { padding: "md", children: "A record card on the page wash." },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Inset: Story = { args: { tone: "inset", children: "A well inside another card." } };
export const Interactive: Story = { args: { interactive: true, children: "Hover me: the whole card is clickable." } };

export const WithHeaderAndFooter: Story = {
  render: () => (
    <Card className="max-w-xl">
      <CardHeader eyebrow="Plaza" title="Plaza camera" description="Open space · stopped" icon={<Camera size={18} />} actions={<Button variant="secondary" size="sm">Settings</Button>} divided />
      <div className="p-5 text-sm text-(--tanaw-text-secondary)">Camera preview is paused. Start this camera to view its video and visitor counts.</div>
      <CardFooter>
        <Button variant="secondary">Cancel</Button>
        <Button>Start camera</Button>
      </CardFooter>
    </Card>
  ),
};

export const SectionLabels: Story = {
  render: () => (
    <div className="space-y-3">
      <SectionLabel>Unique visitors</SectionLabel>
      <SectionLabel tone="eyebrow">This computer</SectionLabel>
      <SectionLabel tone="muted">Showing 12 reports</SectionLabel>
    </div>
  ),
};
