import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { emailDeliveriesQueryKey, filterEmailDeliveries } from "../model";
import { listEmailDeliveries, retryEmailDelivery } from "../services";

const EMPTY_DELIVERIES: never[] = [];

export function useEmailDeliveries(problemsOnly: boolean) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deliveriesQuery = useQuery({ queryKey: emailDeliveriesQueryKey, queryFn: listEmailDeliveries });
  const retryMutation = useMutation({
    mutationFn: retryEmailDelivery,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey });
      toast.success("Email retry queued");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to retry this email")),
  });
  const deliveries = deliveriesQuery.data ?? EMPTY_DELIVERIES;
  const filteredDeliveries = useMemo(() => filterEmailDeliveries(deliveries, query, problemsOnly), [deliveries, problemsOnly, query]);

  return {
    deliveries: filteredDeliveries,
    isEmpty: filteredDeliveries.length === 0,
    isLoading: deliveriesQuery.isLoading,
    isRetrying: retryMutation.isPending,
    query,
    retry: retryMutation.mutate,
    setQuery,
  };
}
