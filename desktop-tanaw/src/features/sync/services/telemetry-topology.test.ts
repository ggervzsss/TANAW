import type { InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";
import { clearTelemetryTopologyCache, discoverAuthenticatedTelemetryIdentity } from "./telemetry-topology";
import type { EnterpriseSiteTopology } from "./telemetry-v2-contracts";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTERPRISE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SITE_ID = "99999999-9999-4999-8999-999999999999";
const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const CAMERA_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SECOND_SITE_ID = "12121212-1212-4121-8121-121212121212";
const SECOND_DEVICE_ID = "13131313-1313-4131-8131-131313131313";
const SECOND_CAMERA_ID = "14141414-1414-4141-8141-141414141414";

describe("authenticated telemetry topology discovery", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    clearTelemetryTopologyCache();
    setEnterpriseAccount(ACCOUNT_ID, "desktop-token");
  });

  afterEach(() => {
    clearTelemetryTopologyCache();
    vi.restoreAllMocks();
    useAuthStore.setState({ isAuthenticated: false, token: null, user: null });
    vi.unstubAllGlobals();
  });

  it("uses the bearer-authenticated v2 GET and caches canonical identity per account", async () => {
    const originalAdapter = staffApi.defaults.adapter;
    const adapter = vi.fn(async (config: unknown) => ({
      config: config as InternalAxiosRequestConfig,
      data: topologyPage([topologySite(SITE_ID, DEVICE_ID, CAMERA_ID)]),
      headers: {},
      status: 200,
      statusText: "OK",
    }));
    staffApi.defaults.adapter = adapter;

    try {
      const first = await discoverAuthenticatedTelemetryIdentity();
      const cached = await discoverAuthenticatedTelemetryIdentity();

      expect(first).toEqual({ enterpriseId: ENTERPRISE_ID, siteId: SITE_ID, deviceId: DEVICE_ID, cameraIds: [CAMERA_ID] });
      expect(cached).toEqual(first);
      expect(adapter).toHaveBeenCalledTimes(1);
      const config = adapter.mock.calls[0][0] as InternalAxiosRequestConfig;
      expect(config.method).toBe("get");
      expect(config.url).toBe("/operational/desktop/sites/v2");
      expect(config.params).toEqual({ limit: 50 });
      expect(config.headers.Authorization).toBe("Bearer desktop-token");

      setEnterpriseAccount("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "second-token");
      await discoverAuthenticatedTelemetryIdentity();
      expect(adapter).toHaveBeenCalledTimes(2);
      expect((adapter.mock.calls[1][0] as InternalAxiosRequestConfig).headers.Authorization).toBe("Bearer second-token");
    } finally {
      staffApi.defaults.adapter = originalAdapter;
    }
  });

  it("walks every page and fails closed when ready sites are split across pages", async () => {
    const get = vi.spyOn(staffApi, "get");
    get
      .mockResolvedValueOnce(axiosResponse(topologyPage([topologySite(SITE_ID, DEVICE_ID, CAMERA_ID)], SECOND_SITE_ID)))
      .mockResolvedValueOnce(axiosResponse(topologyPage([topologySite(SECOND_SITE_ID, SECOND_DEVICE_ID, SECOND_CAMERA_ID)])));

    await expect(discoverAuthenticatedTelemetryIdentity()).rejects.toMatchObject({ code: "TELEMETRY_TOPOLOGY_AMBIGUOUS" });

    expect(get).toHaveBeenNthCalledWith(1, "/operational/desktop/sites/v2", { params: { limit: 50 } });
    expect(get).toHaveBeenNthCalledWith(2, "/operational/desktop/sites/v2", {
      params: { afterSiteId: SECOND_SITE_ID, limit: 50 },
    });
  });

  it("rejects repeated cursors and malformed topology envelopes", async () => {
    const get = vi.spyOn(staffApi, "get");
    get.mockResolvedValue(axiosResponse(topologyPage([], SECOND_SITE_ID)));

    await expect(discoverAuthenticatedTelemetryIdentity()).rejects.toMatchObject({
      code: "TELEMETRY_TOPOLOGY_PAGINATION_INVALID",
    });
    expect(get).toHaveBeenCalledTimes(2);

    clearTelemetryTopologyCache();
    get.mockReset().mockResolvedValue(axiosResponse({ items: [], nextCursor: null }));
    await expect(discoverAuthenticatedTelemetryIdentity()).rejects.toMatchObject({
      code: "TELEMETRY_TOPOLOGY_RESPONSE_INVALID",
    });
  });

  it("rejects a response that crosses canonical enterprise boundaries", async () => {
    const foreign = {
      ...topologySite(SECOND_SITE_ID, SECOND_DEVICE_ID, SECOND_CAMERA_ID),
      enterpriseId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      topologyStatus: "unlinked" as const,
      devices: [],
    };
    vi.spyOn(staffApi, "get").mockResolvedValue(axiosResponse(topologyPage([topologySite(SITE_ID, DEVICE_ID, CAMERA_ID), foreign])));

    await expect(discoverAuthenticatedTelemetryIdentity()).rejects.toMatchObject({
      code: "TELEMETRY_TOPOLOGY_RESPONSE_INVALID",
    });
  });
});

function setEnterpriseAccount(accountId: string, token: string) {
  useAuthStore.setState({
    isAuthenticated: true,
    token,
    user: {
      id: accountId,
      email: `${accountId}@example.test`,
      name: "Enterprise operator",
      role: "enterprise",
    },
  });
}

function topologyPage(items: EnterpriseSiteTopology[], nextCursor: string | null = null) {
  return { evaluatedAt: "2026-07-13T08:00:00Z", items, nextCursor };
}

function topologySite(siteId: string, deviceId: string, cameraId: string) {
  return {
    classification: "official" as const,
    devices: [
      {
        cameras: [{ cameraId, lifecycleState: "active" as const }],
        deviceId,
        lifecycleState: "active" as const,
      },
    ],
    enterpriseId: ENTERPRISE_ID,
    enterpriseLifecycleState: "active" as const,
    siteId,
    topologyStatus: "ready" as const,
  };
}

function axiosResponse(data: unknown) {
  return {
    config: {} as InternalAxiosRequestConfig,
    data,
    headers: {},
    status: 200,
    statusText: "OK",
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
