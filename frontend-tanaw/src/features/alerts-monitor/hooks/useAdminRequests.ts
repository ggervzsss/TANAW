import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getRequest, listRequests, markRequestsRead, requestDetailQueryKey, requestsQueryKey, type Request } from "@/shared/services/requests";

const EMPTY: Request[] = [];

/** Every request, with this account's New and Updated marks from the server. */
export function useAdminRequests() {
  const query = useQuery({ queryKey: requestsQueryKey, queryFn: listRequests });
  return {
    requests: query.data ?? EMPTY,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}

/** The selected request's timeline. */
export function useRequestDetail(request: Request | null) {
  return useQuery({
    queryKey: requestDetailQueryKey(request?.id ?? ""),
    queryFn: () => getRequest(request?.id ?? ""),
    enabled: Boolean(request),
  });
}

/** Read marks: opening a request marks it read; "Mark all as read" marks every request. */
export function useRequestReadMarks(selected: Request | null, ready: boolean) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: markRequestsRead,
    onMutate: (ids) => {
      queryClient.setQueryData<Request[]>(requestsQueryKey, (current) =>
        current?.map((request) => (ids === "all" || ids.includes(request.id) ? { ...request, unread: false, updated: false } : request)),
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: requestsQueryKey }),
  });
  const needsMark = Boolean(selected && (selected.unread || selected.updated));
  const selectedId = selected?.id;
  const { mutate } = mutation;
  useEffect(() => {
    if (ready && needsMark && selectedId) mutate([selectedId]);
  }, [mutate, needsMark, ready, selectedId]);
  return { markAllRead: () => mutate("all") };
}
