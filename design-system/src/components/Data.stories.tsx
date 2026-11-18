import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { DetailField, DetailList } from "./DetailField";
import { ExpandableText } from "./ExpandableText";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./Table";

const meta = { title: "Components/Data display", component: Table } satisfies Meta<typeof Table>;
export default meta;
type Story = StoryObj<typeof meta>;

const rows = [
  { day: "1 Nov", city: 214, province: 61, country: 12, foreign: 3 },
  { day: "2 Nov", city: 198, province: 70, country: 9, foreign: 0 },
  { day: "3 Nov", city: 0, province: 0, country: 0, foreign: 0 },
];

/** Counts are right-aligned tabular figures; totals are bold. */
export const DataTable: Story = {
  render: () => (
    <Table ariaLabel="Visitor origins" wrapperClassName="max-w-3xl rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface)">
      <TableHead>
        <tr>
          <TableHeaderCell>Day</TableHeaderCell>
          <TableHeaderCell numeric>This city</TableHeaderCell>
          <TableHeaderCell numeric>This province</TableHeaderCell>
          <TableHeaderCell numeric>Other provinces</TableHeaderCell>
          <TableHeaderCell numeric>Foreign</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.day} interactive>
            <TableCell>{row.day}</TableCell>
            <TableCell numeric>{row.city}</TableCell>
            <TableCell numeric>{row.province}</TableCell>
            <TableCell numeric>{row.country}</TableCell>
            <TableCell numeric>{row.foreign}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell emphasis>Total</TableCell>
          <TableCell numeric emphasis>
            412
          </TableCell>
          <TableCell numeric emphasis>
            131
          </TableCell>
          <TableCell numeric emphasis>
            21
          </TableCell>
          <TableCell numeric emphasis>
            3
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const DetailFields: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <DetailField label="Problem" value="Camera stream unavailable" />
        <DetailField label="Status" value={<Badge tone="warning">Working on it</Badge>} />
      </div>
      <DetailList
        items={[
          { label: "Enterprise", value: "Plaza Hotel" },
          { label: "Barangay", value: "Poblacion" },
          { label: "Cameras", value: "2 of 3 running" },
        ]}
        columns={3}
      />
    </div>
  ),
};

export const LongText: Story = {
  render: () => (
    <div className="w-64 rounded-tanaw-md border border-(--tanaw-border-soft) p-3 text-sm">
      <ExpandableText
        ariaLabel="summary"
        primary="The entrance camera stopped sending frames after the router restarted, and the stream has not reconnected since early this morning."
        secondary="Reported by the front desk"
        secondaryClassName="text-xs text-(--tanaw-text-muted)"
      />
    </div>
  ),
};

export const Avatars: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar name="LGU Staff" size="sm" />
      <Avatar name="Plaza Hotel" />
      <Avatar name="IT Personnel" size="lg" />
    </div>
  ),
};
