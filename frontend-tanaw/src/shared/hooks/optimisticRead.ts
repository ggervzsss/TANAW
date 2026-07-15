export async function runOptimisticRead<T>(options: {
  request: () => Promise<T>;
  onSuccess: (result: T) => void;
  onFailure: () => void;
  onSettled: () => void;
}) {
  try {
    options.onSuccess(await options.request());
  } catch {
    options.onFailure();
  } finally {
    options.onSettled();
  }
}
