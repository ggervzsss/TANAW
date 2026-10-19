import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useEffect, useState } from "react";
import type { Camera } from "../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getMlCameraStates, getMlServiceStatus, getOpenSpaceMetrics } from "../camera/services/ml-service";
import { formatDwell } from "../camera/utils/open-space";
import type { AreaLive, AreaMetrics } from "./types";

export function OpenSpaceDashboard({ cameras }: { cameras: Camera[] }) {
  const [cameraId, setCameraId] = useState(cameras[0]?.id ?? 0);
  const [days, setDays] = useState(7);
  const [revision, setRevision] = useState("");
  const [metrics, setMetrics] = useState<AreaMetrics | null>(null);
  const [live, setLive] = useState<AreaLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const selected = cameras.some((c) => c.id === cameraId) ? cameraId : (cameras[0]?.id ?? 0);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    const refresh = async () => {
      if (!selected || busy) return;
      busy = true;
      try {
        const status = await getMlServiceStatus();
        const base = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const [data, states] = await Promise.all([getOpenSpaceMetrics(base, selected, days, revision, page * 20), getMlCameraStates(base)]);
        if (!disposed) {
          setMetrics(data);
          setLive(states.cameras.find((c) => c.camera_id === selected)?.area ?? null);
          setError(null);
        }
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : "Unable to load area analytics.");
          setLive(null);
        }
      } finally {
        busy = false;
      }
    };
    setMetrics(null);
    setLive(null);
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [selected, days, revision, page]);
  const labels = ["Under 1 minute", "1–<5 minutes", "5–<15 minutes", "15–<30 minutes", "30 minutes or longer"];
  return (
    <section className="space-y-4 rounded-2xl border border-cyan-200 bg-white p-5 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h2 className="text-xl font-bold">Open Space Activity</h2>
      <p className="text-sm">
        Estimated time in the monitored camera zone. Visits represent observations, not unique people. History stays on this device; LGU cloud reporting is not enabled for this mode.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          Camera{" "}
          <select
            aria-label="Analytics camera"
            className="rounded border p-2 dark:bg-slate-800"
            value={selected}
            onChange={(e) => {
              setCameraId(Number(e.target.value));
              setRevision("");
              setPage(0);
            }}
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.zone}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period{" "}
          <select
            aria-label="Analytics period"
            className="rounded border p-2 dark:bg-slate-800"
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(0);
            }}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>
        <label>
          Zone configuration{" "}
          <select
            aria-label="Zone revision"
            className="rounded border p-2 dark:bg-slate-800"
            value={revision}
            onChange={(e) => {
              setRevision(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Latest monitored configuration</option>
            {metrics?.revisions.map((r) => (
              <option key={r.revision_id} value={r.revision_id}>
                {r.zone_name} · {new Date(r.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-300">
          {error} Previously loaded figures may be outdated.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="People observed now" value={live?.available ? live.presence : "Unavailable"} />
        <Metric label="Peak observed presence" value={metrics?.peak_presence ?? "—"} />
        <Metric label="Median completed dwell" value={formatDwell(metrics?.median_dwell_ms ?? null)} />
        <Metric label="Average completed dwell" value={formatDwell(metrics?.average_dwell_ms ?? null)} />
        <Metric label="Observed visits" value={metrics?.observed_visits ?? "—"} />
        <Metric label="Completed visits" value={metrics?.completed_count ?? "—"} />
        <Metric label="Incomplete observations" value={metrics?.incomplete_count ?? "—"} />
        <Metric label="Observation coverage" value={metrics ? `${(metrics.coverage_ratio * 100).toFixed(1)}%` : "—"} />
      </div>
      <p className="text-sm">
        {metrics?.completed_count
          ? `Dwell statistics use ${metrics.completed_count} completed visits with observed arrival and departure. P90: ${formatDwell(metrics.p90_dwell_ms)}.`
          : "No completed visits yet. Unknown arrivals, lost tracks, ongoing visits, and interruptions do not enter dwell averages."}{" "}
        Temporary tracking gaps now: {live?.available ? live.temporarily_missing : "Unavailable"}. Unavailable intervals are not empty-area counts.
      </p>
      <p className="text-xs">
        Visit counts use first observation; completed dwell uses the observed end in the selected period. Changing geometry starts a separate configuration history. The selected revision is summarized
        independently. Live presence always describes the current camera configuration.
      </p>
      <figure aria-label="Hourly observed presence and arrivals" className="rounded-xl border p-3">
        <figcaption className="mb-3 font-semibold">Hourly area activity · Asia/Manila</figcaption>
        {metrics?.history.some((row) => row.covered_ms > 0) ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={metrics.history.map((row) => ({ ...row, arrivals: row.covered_ms > 0 ? (row.arrivals ?? 0) : null }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="at" minTickGap={45} tickFormatter={(value) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit" })} />
                <YAxis allowDecimals={false} />
                <Tooltip labelFormatter={(value) => new Date(String(value)).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} />
                <Legend />
                <Bar dataKey="arrivals" name="Observed arrivals" fill="#0891b2" />
                <Line dataKey="peak_presence" name="Peak observed presence" stroke="#10b981" dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm">No covered observations for the selected configuration and period.</p>
        )}
      </figure>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold">Completed dwell distribution</h3>
          {labels.map((label, i) => (
            <div key={label} className="my-2 flex justify-between border-b py-1 text-sm">
              <span>{label}</span>
              <span>{metrics?.duration_buckets[i] ?? "—"}</span>
            </div>
          ))}
        </div>
        <div className="max-h-80 overflow-auto">
          <h3 className="font-semibold">Hourly observations · Asia/Manila</h3>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Hour</th>
                <th>Peak</th>
                <th>Covered</th>
                <th>Arrivals</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {metrics?.history.map((h) => (
                <tr key={h.at}>
                  <td>{new Date(h.at).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit" })}</td>
                  <td>{h.peak_presence ?? "—"}</td>
                  <td>{Math.round(h.covered_ms / 60000)} min</td>
                  <td>{h.covered_ms > 0 ? (h.arrivals ?? 0) : "—"}</td>
                  <td>{h.covered_ms > 0 ? h.completed_count : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {metrics?.last_observed_at && <p className="text-xs">History last observed: {new Date(metrics.last_observed_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>}
      <details>
        <summary className="cursor-pointer font-semibold">Visit observations</summary>
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>First observed</th>
              <th>Observation</th>
              <th>Duration</th>
              <th>End reason</th>
            </tr>
          </thead>
          <tbody>
            {metrics?.visits.map((v) => (
              <tr key={v.visit_id}>
                <td>{new Date(v.first_inside_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td>
                <td>{v.status}</td>
                <td>{formatDwell(v.estimated_dwell_ms)}</td>
                <td>{v.termination_reason?.replace(/_/g, " ") ?? "Ongoing"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-3">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button disabled={!metrics || (page + 1) * 20 >= metrics.total_records} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </details>
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-xs">{label}</p>
      <p className="mt-1 text-xl font-bold">{value ?? "—"}</p>
    </div>
  );
}
