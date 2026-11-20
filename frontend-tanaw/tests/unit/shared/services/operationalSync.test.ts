import { expect, it, vi } from "vitest";
import { apiClient } from "../../../../src/shared/lib/apiClient";
import { listFinalReports } from "../../../../src/shared/services/operationalSync";

vi.mock("../../../../src/shared/lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

it("loads older generated reports after the first full API page", async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: `report-${index}` }));
  const olderReport = { id: "older-report" };
  const { signal } = new AbortController();
  vi.mocked(apiClient.get).mockResolvedValueOnce({ data: firstPage }).mockResolvedValueOnce({ data: [olderReport] });

  await expect(listFinalReports({ signal })).resolves.toEqual([...firstPage, olderReport]);
  expect(apiClient.get).toHaveBeenNthCalledWith(2, "/operational/reports/final", { params: { offset: 500 }, signal });
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});
