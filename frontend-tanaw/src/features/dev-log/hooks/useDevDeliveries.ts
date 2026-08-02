import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { devDeliveriesQueryKey, listDevDeliveries, type DevDelivery } from "../services";

const EMPTY_DELIVERIES: DevDelivery[] = [];

export function useDevDeliveries() {
  const [query, setQuery] = useState("");
  const deliveriesQuery = useQuery({ queryKey: devDeliveriesQueryKey, queryFn: listDevDeliveries });
  const deliveries = deliveriesQuery.data ?? EMPTY_DELIVERIES;
  const filteredDeliveries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return deliveries.filter((delivery) => `${delivery.recipient} ${delivery.subject} ${delivery.body}`.toLowerCase().includes(normalizedQuery));
  }, [deliveries, query]);
  return { filteredDeliveries, isLoading: deliveriesQuery.isLoading, query, setQuery };
}
