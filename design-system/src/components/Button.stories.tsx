import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

const meta = {
  title: "Components/Button",
  component: Button,
  args: { children: "Submit report", variant: "primary", size: "md" },
  argTypes: { onClick: { action: "pressed" } },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: "secondary", children: "Review report form" } };
export const Danger: Story = { args: { variant: "danger", children: "Delete camera", leadingIcon: <Trash2 size={16} /> } };
export const Ghost: Story = { args: { variant: "ghost", children: "Cancel" } };
export const Link: Story = { args: { variant: "link", children: "View all notifications" } };
export const Loading: Story = { args: { loading: true, children: "Submitting" } };
export const Disabled: Story = { args: { disabled: true } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button leadingIcon={<Plus size={16} />}>Add camera</Button>
      <Button variant="secondary" leadingIcon={<Download size={16} />}>
        Download PDF
      </Button>
      <Button variant="secondary" trailingIcon={<RefreshCw size={16} />}>
        Refresh counts
      </Button>
    </div>
  ),
};

/** Secondary before primary, primary last on the right. */
export const ActionRow: Story = {
  render: () => (
    <div className="flex justify-end gap-2">
      <Button variant="secondary">Cancel</Button>
      <Button>Save changes</Button>
    </div>
  ),
};

export const IconButtons: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton label="Refresh" icon={<RefreshCw size={16} />} variant="secondary" />
      <IconButton label="Delete" icon={<Trash2 size={16} />} variant="danger" />
      <IconButton label="Refresh" icon={<RefreshCw size={16} />} />
      <span className="rounded-tanaw-md bg-tanaw-civic p-3">
        <IconButton label="Notifications" icon={<RefreshCw size={16} />} variant="glass" />
      </span>
    </div>
  ),
};
