import { useQuery } from "@tanstack/react-query";
import { isClosedRequest, listRequests, requestsQueryKey, type Request } from "@/shared/services/requests";
import type { UserRole } from "@/shared/types/role.types";
import type { NavigationBadge } from "../navigation";

/** Requests that are open and that nobody in IT has picked up yet. */
export function countRequestsNotPickedUp(requests: readonly Pick<Request, "status" | "handledBy">[]) {
  return requests.filter((request) => !isClosedRequest(request) && !request.handledBy).length;
}

/** "1 request not picked up yet" / "3 requests not picked up yet". */
export function requestsNotPickedUpLabel(count: number) {
  return `${count} ${count === 1 ? "request" : "requests"} not picked up yet`;
}

/** Counts beside the topbar links: IT sees how many requests nobody has picked up. */
export function useNavigationBadges(role: UserRole): Partial<Record<string, NavigationBadge>> {
  const requestsQuery = useQuery({ queryKey: requestsQueryKey, queryFn: listRequests, enabled: role === "it" });
  if (role !== "it") return {};
  const count = countRequestsNotPickedUp(requestsQuery.data ?? []);
  return count > 0 ? { requests: { count, label: requestsNotPickedUpLabel(count) } } : {};
}
