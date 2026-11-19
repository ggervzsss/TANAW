import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";
import { TopbarAccount } from "./TopbarAccount";

const meta = {
  title: "Patterns/Topbar Account",
  component: TopbarAccount,
  decorators: [
    (Story) => (
      <div className="flex min-h-80 justify-end bg-emerald-950 p-5">
        <div>
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    account: { name: "Sample Account", email: "sample@example.com", role: "Admin Account" },
    className: "border-white/25 bg-white/8",
    onEditProfile: () => undefined,
    onSettings: () => undefined,
    onHelp: () => undefined,
    onSignOut: () => undefined,
  },
} satisfies Meta<typeof TopbarAccount>;

export default meta;

export const Closed: StoryObj<typeof meta> = {};
export const Open: StoryObj<typeof meta> = {
  args: { activeAction: "settings" },
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Open account menu" }));
  },
};
