import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { Button } from "../components/Button";
import { PageHeader } from "./PageHeader";

const meta = {
  title: "Patterns/Page header",
  component: PageHeader,
  args: { title: "Camera Monitoring", description: "View camera status and check if the counting is working properly." },
} satisfies Meta<typeof PageHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithEyebrow: Story = { args: { eyebrow: "This computer", title: "Developer Settings", description: "Diagnostic overlays for testing cameras." } };
export const WithActions: Story = { args: { title: "LGU Accounts", description: "Staff and Admin accounts for city hall.", actions: <Button leadingIcon={<Plus size={16} />}>Create account</Button> } };
