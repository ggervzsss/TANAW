import { describe, expect, it } from "vitest";
import { parseOperationalNotificationInvalidation } from "./notifications";

const RECIPIENT_ID = "df6918fd-a590-428c-a76d-60eb2d5076b8";

function notificationInvalidation(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "resource.invalidated",
    data: {
      contractVersion: 2,
      resource: {
        type: "user_notification",
        id: "dc3f2167-2964-4c2c-820e-d618fc4d3c9d",
        version: 1,
      },
      scope: {
        classification: "official",
        recipientAccountId: RECIPIENT_ID,
      },
      refetchRequired: true,
    },
    ...overrides,
  });
}

describe("parseOperationalNotificationInvalidation", () => {
  it("accepts an exact target notification invalidation for the signed-in account", () => {
    const result = parseOperationalNotificationInvalidation(notificationInvalidation(), RECIPIENT_ID);

    expect(result?.data.resource.type).toBe("user_notification");
    expect(result?.data.scope.recipientAccountId).toBe(RECIPIENT_ID);
  });

  it("rejects another account's notification invalidation", () => {
    expect(parseOperationalNotificationInvalidation(notificationInvalidation(), "another-account")).toBeNull();
  });

  it.each([
    ["malformed JSON", "{"],
    ["direct notification payload", JSON.stringify({ type: "notification.created" })],
    ["missing account context", notificationInvalidation()],
  ])("rejects %s", (_label, payload) => {
    const accountId = payload === notificationInvalidation() ? undefined : RECIPIENT_ID;
    expect(parseOperationalNotificationInvalidation(payload, accountId)).toBeNull();
  });
});
