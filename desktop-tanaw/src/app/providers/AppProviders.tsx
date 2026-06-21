import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { Toaster } from "react-hot-toast";
import { HashRouter } from "react-router-dom";
import { queryClient } from "../../lib/queryClient";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        {children}
        <Toaster position="top-right" />
      </HashRouter>
    </QueryClientProvider>
  );
}
