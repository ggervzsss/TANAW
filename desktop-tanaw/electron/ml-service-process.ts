export function buildWindowsListenerPidScript(port: number) {
  return [
    `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    "| Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::1' }",
    "| Select-Object -First 1",
    "; if ($null -ne $conn) { $conn.OwningProcess }",
  ].join(" ");
}

export function buildWindowsTerminateTreeArgs(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("A positive process ID is required.");
  }
  return ["/PID", String(pid), "/T", "/F"];
}

export async function waitForListenerRelease(findListenerPid: () => Promise<number | null>, timeoutMs: number, pollIntervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await findListenerPid()) === null) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

export function shouldTerminateExternalService(connectedExternally: boolean, hasManagedProcess: boolean) {
  return connectedExternally && !hasManagedProcess;
}
