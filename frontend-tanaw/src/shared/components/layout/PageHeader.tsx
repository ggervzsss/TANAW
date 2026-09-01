import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

type SetPageHeader = (title: string, description: string) => void;
const PageHeaderContext = createContext<SetPageHeader>(() => undefined);

export function PageHeaderProvider({ children, setHeader }: { children: ReactNode; setHeader: SetPageHeader }) {
  return <PageHeaderContext.Provider value={setHeader}>{children}</PageHeaderContext.Provider>;
}

type PageHeaderProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function PageHeader({ title, description, action }: PageHeaderProps) {
  const setHeader = useContext(PageHeaderContext);

  useEffect(() => {
    setHeader(title, description);
  }, [title, description, setHeader]);

  if (!action) return null;

  return <div className="mb-6 flex justify-end max-md:justify-start">{action}</div>;
}
