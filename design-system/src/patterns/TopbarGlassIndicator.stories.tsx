import type { Meta, StoryObj } from "@storybook/react-vite";
import { Camera, FileText, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { TopbarGlassNavigation } from "./TopbarGlassIndicator";

const meta = { title: "Patterns/Topbar glass navigation", component: TopbarGlassNavigation } satisfies Meta<typeof TopbarGlassNavigation>;
export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "cameras", label: "Camera Setup", icon: Camera },
  { id: "reports", label: "Reports", icon: FileText },
];

export const PortalTabs: Story = {
  args: { activeId: "dashboard", isDark: false },
  render: ({ activeId }, { globals }) => {
    const [selected, setSelected] = useState(activeId);
    const isDark = globals.theme === "Dark";
    return (
      <div className={`rounded-lg p-4 text-white ${isDark ? "bg-[#071e18]" : "bg-tanaw-civic-deep"}`}>
        <TopbarGlassNavigation activeId={selected} isDark={isDark} className="relative isolate inline-flex items-center gap-3" aria-label="Enterprise navigation">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="relative z-10 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
              aria-current={id === selected ? "page" : undefined}
              data-topbar-navigation={id}
              onClick={() => setSelected(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </TopbarGlassNavigation>
      </div>
    );
  },
};
