import { useEffect } from "react";
import type { ReactNode } from "react";
import { useHeaderStore } from "@/app/store/headerStore";

type PageHeaderProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function PageHeader({ title, description, action }: PageHeaderProps) {
  const setHeader = useHeaderStore((state) => state.setHeader);

  useEffect(() => {
    setHeader(title, description);
  }, [title, description, setHeader]);

  if (!action) return null;

  return <div className="mb-6 flex justify-end max-md:justify-start">{action}</div>;
}
