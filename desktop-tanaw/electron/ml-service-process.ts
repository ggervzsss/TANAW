export function buildWindowsListenerPidScript(port: number) {
  return [
    `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    "| Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::1' }",
    "| Select-Object -First 1",
    "; if ($null -ne $conn) { $conn.OwningProcess }",
  ].join(" ");
}
