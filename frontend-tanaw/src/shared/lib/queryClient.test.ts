import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { resetAuthenticatedQueryCache } from "./queryClient";

describe("authenticated query cache lifecycle", () => {
  it("removes protected results across every authenticated key namespace", () => {
    const client = new QueryClient();
    client.setQueryData(["operational", "reports", "account-1"], [{ id: "report-1" }]);
    client.setQueryData(["enterprise-accounts"], [{ id: "enterprise-1" }]);

    resetAuthenticatedQueryCache(client);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
