import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { createPageStateKey, readPageState, removePageState, sameSerializableValue, writePageState, type PageStateStorage } from "@/shared/utils/pageState";

type ScopedPageStateOptions<T> = {
  initialValue: T;
  isValid: (value: unknown) => value is T;
  namespace: string;
  preferInitial?: boolean;
  storage?: PageStateStorage;
  version: number;
};

export function useScopedPageState<T>({
  initialValue,
  isValid,
  namespace,
  preferInitial = false,
  storage = "session",
  version,
}: ScopedPageStateOptions<T>): [T, Dispatch<SetStateAction<T>>, () => void] {
  const { pathname } = useLocation();
  const user = useAuthStore((state) => state.user);
  const scope = useMemo(
    () => ({
      portal: "web",
      role: user?.role ?? "anonymous",
      userId: user?.id ?? "anonymous",
    }),
    [user?.id, user?.role],
  );
  const key = useMemo(() => createPageStateKey(scope, pathname, namespace), [namespace, pathname, scope]);
  const [value, setValue] = useState<T>(() => (preferInitial ? initialValue : (readPageState(key, version, isValid, storage) ?? initialValue)));

  useEffect(() => {
    if (sameSerializableValue(value, initialValue)) {
      removePageState(key, storage);
      return;
    }
    writePageState(key, version, value, storage);
  }, [initialValue, key, storage, value, version]);

  const clear = useCallback(() => {
    removePageState(key, storage);
    setValue(initialValue);
  }, [initialValue, key, storage]);

  return [value, setValue, clear];
}

export { clearScopedPageState, createPageStateKey, readPageState, writePageState } from "@/shared/utils/pageState";
