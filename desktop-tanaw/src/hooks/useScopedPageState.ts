import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "../features/login/stores/auth-store";
import {
  createPageStateKey,
  readPageState,
  removePageState,
  sameSerializableValue,
  writePageState,
  type PageStateStorage,
} from "../utils/page-state";

type ScopedPageStateOptions<T> = {
  initialValue: T;
  isValid: (value: unknown) => value is T;
  namespace: string;
  storage?: PageStateStorage;
  version: number;
};

export function useScopedPageState<T>({
  initialValue,
  isValid,
  namespace,
  storage = "session",
  version,
}: ScopedPageStateOptions<T>): [T, Dispatch<SetStateAction<T>>, () => void] {
  const { pathname } = useLocation();
  const user = useAuthStore((state) => state.user);
  const scope = useMemo(
    () => ({
      portal: "desktop",
      role: user?.role ?? "anonymous",
      userId: user?.id ?? "anonymous",
    }),
    [user?.id, user?.role],
  );
  const key = useMemo(() => createPageStateKey(scope, pathname, namespace), [namespace, pathname, scope]);
  const [value, setValue] = useState<T>(() => readPageState(key, version, isValid, storage) ?? initialValue);

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

export { clearScopedPageState, createPageStateKey, readPageState, writePageState } from "../utils/page-state";
