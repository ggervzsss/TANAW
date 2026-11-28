import type { Request } from "../../../src/shared/services/requests";

/** A request as the API lists it, with sensible defaults. */
export function request(overrides: Partial<Request> & Pick<Request, "id">): Request {
  return {
    code: `REQ-${overrides.id}`,
    group: "Desktop app or camera problem",
    title: "Entrance camera keeps disconnecting",
    description: "The entrance camera drops off every few minutes.",
    status: "In Progress",
    enterpriseId: "ENT-1",
    enterpriseName: "Sampaguita Gardens",
    requesterName: "Rina Dizon",
    createdAt: "2026-11-23T06:00:00Z",
    updatedAt: "2026-11-23T06:00:00Z",
    unread: false,
    updated: false,
    seenByIt: false,
    ...overrides,
  };
}
