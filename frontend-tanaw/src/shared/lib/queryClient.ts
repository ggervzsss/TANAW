import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

/**
 * Cancels in-flight authenticated reads and removes their cached results.
 *
 * TANAW still has protected queries outside a single key namespace, so an auth
 * boundary must remove the complete query cache. Mutation state is deliberately
 * retained so an in-progress login mutation can finish normally.
 */
export function resetAuthenticatedQueryCache(client: QueryClient = queryClient) {
  void client.cancelQueries();
  client.removeQueries();
}
