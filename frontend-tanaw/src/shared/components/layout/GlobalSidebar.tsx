import { NavLink } from "react-router-dom";
import { CITY_SEAL } from "../../constants/branding";
import type { UserRole } from "../../types/role.types";
import { roleNavigation, rolePortalLabel } from "./navigation";

type GlobalSidebarProps = {
  role: UserRole;
  showDevLog?: boolean;
};

export function GlobalSidebar({ role, showDevLog = false }: GlobalSidebarProps) {
  const navigation = role === "it" && !showDevLog ? roleNavigation[role].filter((item) => item.id !== "dev-log") : roleNavigation[role];

  return (
    <aside className="bg-tanaw-green z-20 flex h-full w-64 flex-col rounded-r-4xl border-r border-white/10 text-white shadow-2xl max-[920px]:h-auto max-[920px]:w-full max-[920px]:rounded-none">
      <div className="mt-4 flex flex-col items-center border-b border-white/10 p-6 max-[920px]:mt-0">
        <img src={CITY_SEAL} alt="San Pedro Seal" className="mb-2 h-16 w-16 drop-shadow-md" />
        <h1 className="font-display text-2xl font-bold tracking-wider">TANAW</h1>
        <span className="text-tanaw-sky mt-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-widest uppercase">{rolePortalLabel[role]}</span>
      </div>

      <nav className="mt-4 flex-1 space-y-2 p-4 max-[920px]:grid max-[920px]:grid-cols-2 max-[920px]:space-y-0 max-sm:grid-cols-1" aria-label={`${rolePortalLabel[role]} navigation`}>
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) =>
                [
                  "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 active:scale-[0.99]",
                  isActive ? "text-tanaw-green bg-white shadow-lg shadow-black/10" : "text-white/80 hover:bg-white/10 hover:text-white hover:shadow-sm",
                ].join(" ")
              }
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
