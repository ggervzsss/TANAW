import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { staffApi } from "../../lib/axios";
import { resolveSystemTimeFormat } from "../../utils/date-time";
import { useAuthStore } from "../login/stores/auth-store";
import { getAccountPreferences, updateAccountPreferences } from "./account-preferences-service";
import {
  defaultDisplayPreferences,
  SystemDisplayPreferencesContext,
  textSizeRootValue,
  type DisplayPreferences,
  type PreferenceSaveStatus,
} from "./system-display-preferences";

type SystemSettingsResponse = {
  values: Record<string, string | boolean | number>;
};

export function SystemDisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const accountId = useAuthStore((state) => state.user?.id);
  const settingsQuery = useQuery({
    queryKey: ["system-settings"],
    queryFn: getSystemSettings,
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const [localState, setLocalState] = useState<{ accountId?: string; preferences: DisplayPreferences; status: PreferenceSaveStatus } | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const confirmedRef = useRef<DisplayPreferences>(defaultDisplayPreferences);
  const desiredRef = useRef<DisplayPreferences>(defaultDisplayPreferences);
  const failedDesiredRef = useRef<DisplayPreferences | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const activeAccountIdRef = useRef(accountId);
  const interactionVersionRef = useRef(0);
  const timeFormat = resolveSystemTimeFormat(settingsQuery.data?.values["display.timeFormat"]);
  const activeLocalState = localState?.accountId === accountId ? localState : null;
  const displayPreferences = activeLocalState?.preferences ?? defaultDisplayPreferences;
  const saveStatus = activeLocalState?.status ?? "idle";

  useEffect(() => {
    activeAccountIdRef.current = accountId;
    confirmedRef.current = defaultDisplayPreferences;
    desiredRef.current = defaultDisplayPreferences;
    failedDesiredRef.current = null;
    interactionVersionRef.current = 0;
    if (!token || !accountId) return undefined;
    let disposed = false;
    const interactionVersion = interactionVersionRef.current;
    void getAccountPreferences()
      .then((preferences) => {
        if (disposed || activeAccountIdRef.current !== accountId || interactionVersionRef.current !== interactionVersion) return;
        const display = { textSize: preferences.textSize, interfaceScale: preferences.interfaceScale };
        confirmedRef.current = display;
        desiredRef.current = display;
        setLocalState({ accountId, preferences: display, status: "saved" });
      })
      .catch(() => {
        if (!disposed && activeAccountIdRef.current === accountId && interactionVersionRef.current === interactionVersion) {
          setLocalState({ accountId, preferences: defaultDisplayPreferences, status: "error" });
        }
      });
    return () => {
      disposed = true;
    };
  }, [accountId, loadRevision, token]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textSize = displayPreferences.textSize;
    root.dataset.interfaceScale = displayPreferences.interfaceScale;
    root.style.setProperty("--tanaw-root-font-size", textSizeRootValue(displayPreferences.textSize));
  }, [displayPreferences]);

  const persist = useCallback((snapshot: DisplayPreferences, targetAccountId?: string) => {
    saveChainRef.current = saveChainRef.current.then(async () => {
      if (!targetAccountId || activeAccountIdRef.current !== targetAccountId) return;
      setLocalState({ accountId: targetAccountId, preferences: snapshot, status: "saving" });
      try {
        const saved = await updateAccountPreferences(snapshot);
        if (activeAccountIdRef.current !== targetAccountId) return;
        const confirmed = { textSize: saved.textSize, interfaceScale: saved.interfaceScale };
        confirmedRef.current = confirmed;
        failedDesiredRef.current = null;
        if (sameDisplayPreferences(desiredRef.current, snapshot)) {
          desiredRef.current = confirmed;
          setLocalState({ accountId: targetAccountId, preferences: confirmed, status: "saved" });
        }
      } catch {
        if (sameDisplayPreferences(desiredRef.current, snapshot)) {
          failedDesiredRef.current = snapshot;
          desiredRef.current = confirmedRef.current;
          setLocalState({ accountId: targetAccountId, preferences: confirmedRef.current, status: "error" });
        }
      }
    });
  }, []);

  const updateDisplayPreferences = useCallback(
    (patch: Partial<DisplayPreferences>) => {
      const next = { ...desiredRef.current, ...patch };
      interactionVersionRef.current += 1;
      desiredRef.current = next;
      setLocalState({ accountId, preferences: next, status: "saving" });
      persist(next, accountId);
    },
    [accountId, persist],
  );
  const resetDisplayPreferences = useCallback(() => updateDisplayPreferences(defaultDisplayPreferences), [updateDisplayPreferences]);
  const retryDisplayPreferencesSave = useCallback(() => {
    const retry = failedDesiredRef.current;
    if (!retry) {
      setLocalState({ accountId, preferences: defaultDisplayPreferences, status: "idle" });
      setLoadRevision((current) => current + 1);
      return;
    }
    desiredRef.current = retry;
    setLocalState({ accountId, preferences: retry, status: "saving" });
    persist(retry, accountId);
  }, [accountId, persist]);

  return (
    <SystemDisplayPreferencesContext.Provider
      value={{ timeFormat, displayPreferences, saveStatus, updateDisplayPreferences, resetDisplayPreferences, retryDisplayPreferencesSave }}
    >
      {children}
    </SystemDisplayPreferencesContext.Provider>
  );
}

function sameDisplayPreferences(left: DisplayPreferences, right: DisplayPreferences) {
  return left.textSize === right.textSize && left.interfaceScale === right.interfaceScale;
}

async function getSystemSettings() {
  const response = await staffApi.get<SystemSettingsResponse>("/auth/system-settings");
  return response.data;
}
