import type { Camera, CameraCoverage } from "../../../types/enterprise";
import { EMPTY_CAMERA_COVERAGE } from "../utils/camera-coverage";

type Props = {
  cameraId?: number;
  cameras: Camera[];
  value?: CameraCoverage;
  onChange: (value: CameraCoverage) => void;
};

const fieldClass =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white p-2 text-xs text-gray-800 focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export function CameraCoverageControls({ cameraId, cameras, value, onChange }: Props) {
  const coverage = value ?? EMPTY_CAMERA_COVERAGE;
  const others = cameras.filter((camera) => camera.id !== cameraId);
  const linked = ["contained", "overlapping", "alternative"].includes(coverage.relationship);
  const related = others.find((camera) => camera.id === coverage.related_camera_id);
  return (
    <fieldset className="space-y-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
      <legend className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-100">How this camera contributes</legend>
      <p className="text-slate-600 dark:text-slate-300">Both camera modes contribute to one establishment report. Describe this view so shared visitors can be counted together.</p>
      <label className="block font-medium">
        What does this camera watch?
        <select className={fieldClass} value={coverage.role} onChange={(event) => onChange({ ...coverage, role: event.target.value as CameraCoverage["role"] })}>
          <option value="unconfigured">Choose a counting role</option>
          <option value="external_boundary">People entering or leaving the establishment</option>
          <option value="internal_observation">People in an area inside the establishment</option>
        </select>
      </label>
      <label className="block font-medium">
        Area name
        <input className={fieldClass} maxLength={120} value={coverage.area_name} onChange={(event) => onChange({ ...coverage, area_name: event.target.value })} />
      </label>
      <label className="block font-medium">
        How does this view relate to other cameras?
        <select
          className={fieldClass}
          value={coverage.relationship}
          onChange={(event) => {
            const relationship = event.target.value as CameraCoverage["relationship"];
            onChange({ ...coverage, relationship, related_camera_id: ["contained", "overlapping", "alternative"].includes(relationship) ? coverage.related_camera_id : null });
          }}
        >
          <option value="unknown">Choose a coverage relationship</option>
          <option value="independent">Separate area</option>
          <option value="contained">Inside another camera's measured area</option>
          <option value="overlapping">Overlapping view</option>
          <option value="alternative">Backup view of the same area</option>
        </select>
      </label>
      {linked && (
        <label className="block font-medium">
          Related camera
          <select
            className={fieldClass}
            value={coverage.related_camera_id ?? ""}
            onChange={(event) => onChange({ ...coverage, related_camera_id: event.target.value ? Number(event.target.value) : null })}
          >
            <option value="">Select another camera</option>
            {others.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p aria-live="polite" className="border-l-2 border-emerald-700 pl-3 leading-relaxed text-slate-600 dark:border-emerald-400 dark:text-slate-300">
        {coverage.role === "unconfigured" || coverage.relationship === "unknown"
          ? "Choose a role and coverage relationship to complete establishment counting setup."
          : coverage.role === "internal_observation"
            ? "Visitors observed here contribute to the daily visitor estimate. Moving within this area does not add an establishment arrival or departure."
            : "Observed arrivals and departures contribute to establishment movement. A recognized visitor contributes once to the daily visitor estimate."}
        {related && coverage.relationship === "contained" && ` Occupancy is already included in ${related.name}'s measured area.`}
        {related && coverage.relationship === "overlapping" && ` Occupancy reconciles shared people with ${related.name}; unresolved overlap is shown as partial.`}
        {related && coverage.relationship === "alternative" && ` Occupancy uses ${related.name} while available, then this backup view. The two measurements are not added together.`}
        {coverage.relationship === "independent" &&
          " Simultaneous populations in separate areas are added. People can still visit other areas that day; separate views do not automatically mean different visitors."}
      </p>
      {others.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium text-emerald-800 dark:text-emerald-300">Travel between camera areas</summary>
          <p className="mt-2 text-slate-600 dark:text-slate-300">For separate areas, enter the shortest realistic travel time. Leave shared views blank.</p>
          <div className="mt-2 space-y-2">
            {others.map((camera) => (
              <label key={camera.id} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2">
                <span>To {camera.name} (seconds)</span>
                <input
                  aria-label={`Minimum travel time to ${camera.name}`}
                  className={fieldClass}
                  type="number"
                  min={0}
                  max={3600}
                  step={1}
                  value={coverage.travel_seconds[String(camera.id)] ?? ""}
                  onChange={(event) => {
                    const travel_seconds = { ...coverage.travel_seconds };
                    if (event.target.value === "") delete travel_seconds[String(camera.id)];
                    else travel_seconds[String(camera.id)] = Number(event.target.value);
                    onChange({ ...coverage, travel_seconds });
                  }}
                />
              </label>
            ))}
          </div>
        </details>
      )}
    </fieldset>
  );
}
