import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { within } from "storybook/test";
import { Select } from "./Select";

const barangays = ["Bagong Silang", "Calendola", "Chrysanthemum", "Cuyab", "Estrella", "Fatima", "G.S.I.S.", "Landayan", "Langgam", "Laram", "Magsaysay", "Maharlika", "Narra", "Nueva", "Pacita 1", "Pacita 2", "Poblacion", "Riverside", "Rosario", "Sampaguita Village", "San Antonio", "San Lorenzo Ruiz", "San Roque", "San Vicente", "Santo Niño", "United Bayanihan", "United Better Living"];

const meta = {
  title: "Components/Select",
  component: Select,
  args: { value: "Open", options: ["Open", "In Review", "Resolved"], ariaLabel: "Ticket status", onChange: () => undefined },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <Select {...args} value={value} onChange={setValue} className="max-w-xs" />;
  },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithLabel: Story = { args: { label: "Status", ariaLabel: undefined } };
export const Placeholder: Story = { args: { value: "", placeholder: "Choose a status" } };
export const WithMeta: Story = {
  args: {
    value: "2026-11",
    ariaLabel: "Reporting period",
    options: [
      { value: "2026-11", label: "November 2026", meta: "Current" },
      { value: "2026-10", label: "October 2026", meta: "Submitted" },
      { value: "2026-09", label: "September 2026", meta: "Submitted" },
    ],
  },
};
/** Search appears once a searchable list has eight or more options. */
export const Searchable: Story = { args: { value: "All", label: "Select barangay", ariaLabel: undefined, searchable: true, options: ["All", ...barangays], searchPlaceholder: "Search barangays..." } };
export const Small: Story = { args: { size: "sm" } };
export const Invalid: Story = { args: { value: "", placeholder: "Choose a category", error: "Choose a category for this ticket." } };
export const Disabled: Story = { args: { disabled: true } };

/* Open states for the accessibility sweep, which scans the listbox wherever it renders. */
const openList: Story["play"] = async ({ canvasElement, userEvent }) => {
  await userEvent.click(within(canvasElement).getByRole("combobox"));
  await within(canvasElement.ownerDocument.body).findByRole("listbox");
};
export const Open: Story = { tags: ["a11y-open-listbox"], play: openList };
export const SearchableOpen: Story = { ...Searchable, tags: ["a11y-open-listbox"], play: openList };
