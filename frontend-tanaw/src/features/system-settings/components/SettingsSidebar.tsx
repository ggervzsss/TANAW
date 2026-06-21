import { Panel } from "@/shared/components/panel";
import type { SettingSection } from "../types";

type SettingsSidebarProps = {
  sections: SettingSection[];
  activeSectionId: string;
  onSelectSection: (sectionId: string) => void;
};

export function SettingsSidebar({ sections, activeSectionId, onSelectSection }: SettingsSidebarProps) {
  return (
    <Panel className="overflow-hidden p-3">
      {sections.map((section) => {
        const SectionIcon = section.icon;
        const isActive = section.id === activeSectionId;
        return (
          <button
            key={section.id}
            onClick={() => onSelectSection(section.id)}
            className={[
              "mb-2 flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-bold transition last:mb-0",
              isActive ? "bg-tgreen-dark/10 text-tgreen-dark" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900",
            ].join(" ")}
          >
            <SectionIcon className="h-4 w-4" />
            {section.title}
          </button>
        );
      })}
    </Panel>
  );
}
