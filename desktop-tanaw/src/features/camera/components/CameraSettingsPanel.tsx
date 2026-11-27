import { useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { CircleDot, Wifi, ScanLine, List, Wrench, Video, X, Pencil, Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { DesignSwitch } from "../../../components/DesignSwitch";
import { SkeletonText } from "../../../ui-kit";
import { useCameraMorph } from "../hooks/useCameraMorph";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { CAMERA_BRANDS, updateCameraConnection, validateCameraConnection } from "../utils/camera-connection";
import { CAMERA_MODE_LABEL, CAMERA_MODE_OPTIONS, CAMERA_PLACEMENT_NOTE, cameraModeDescription, cameraModeName } from "../utils/camera-mode";
import { DEFAULT_ROI, FIXED_DETECTION_SETTINGS, getDefaultTripwires } from "../model/camera-management";
import { cameraDisplayKey, readCameraDisplay } from "../model/camera-display";
import { validateOpenSpace } from "../utils/open-space";
import { centeredZone, deleteZonePoint, withZonePolygon } from "../utils/open-space-editor";
import { CameraConnectionFields } from "./CameraConnectionFields";
import { CameraMonitoringPanel } from "./CameraMonitoringPanel";
import { CameraVideoPreview, type CameraPreviewState } from "./CameraVideoPreview";
import { OpenSpaceZoneControls } from "./OpenSpaceZoneControls";
import { PasswordVisibilityInput } from "./PasswordVisibilityInput";
import { CameraDialog } from "./CameraDialog";
import { getMlCameraStates, getMlHealth, getMlServiceStatus, testCameraConnection } from "../services/ml-service";
import type { CameraPreviewPanelProps } from "./CameraPreviewPanel";
import type { Camera, OpenSpaceSettings } from "../../../types/enterprise";
import { notifyError, notifyWarning } from "../../toasts/services/toast-service";

const tabs = [
  { id: "information", label: "Information", icon: CircleDot },
  { id: "connection", label: "Connection", icon: Wifi },
  { id: "counting", label: "Counting Area", icon: ScanLine },
  { id: "display", label: "Display", icon: List },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
] as const;
type Tab = (typeof tabs)[number]["id"];
type Props = CameraPreviewPanelProps & { activeCam: Camera; editForm: Camera; initialPreviewState?: CameraPreviewState };

export function CameraSettingsPanel(props: Props) {
  const { activeCam, editForm, onEditFormChange, onCancelEdit, onSave, counts, area, health, detections, streamUrl, hasStoredPassword, storageKey = "tanaw-camera" } = props;
  const [tab, setTab] = useState<Tab>("information");
  const reduceMotion = useReducedMotion() ?? false;
  const identityIconRef = useRef<HTMLSpanElement>(null);
  const identityTitleRef = useRef<HTMLHeadingElement>(null);
  useCameraMorph(identityIconRef, `camera-icon-${activeCam.id}`);
  useCameraMorph(identityTitleRef, `camera-title-${activeCam.id}`);
  const [editorForm, setEditorForm] = useState<Camera | null>(null);
  const [selectedZonePoint, setSelectedZonePoint] = useState<number | null>(null);
  const [previewState, setPreviewState] = useState<CameraPreviewState>(props.initialPreviewState ?? "connecting");
  const editorHistory = useRef<Camera[]>([]);
  const editorInitial = useRef<Camera | null>(null);
  const rememberedArea = useRef(editForm.openSpace);
  const displayKey = cameraDisplayKey(storageKey, activeCam.id);
  const initial = useRef(JSON.stringify(editForm));
  const initialDisplay = useRef(readCameraDisplay(displayKey));
  const [display, setDisplay] = useState(initialDisplay.current);
  const [countingEnabled, setCountingEnabled] = useState(counts.running);
  const initialCounting = useRef(counts.running);
  const runtimeInitialized = useRef(props.runtimeReady !== false);
  useEffect(() => {
    if (runtimeInitialized.current || props.runtimeReady === false) return;
    runtimeInitialized.current = true;
    initialCounting.current = counts.running;
    setCountingEnabled(counts.running);
  }, [counts.running, props.runtimeReady]);
  const [resetPrompt, setResetPrompt] = useState(false);
  const [discard, setDiscard] = useState<"settings" | "editor" | null>(null);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const busy = props.isSaving || saving || reconnecting || testing || diagnosing || props.isStopping;
  const dirty = JSON.stringify(editForm) !== initial.current || JSON.stringify(display) !== JSON.stringify(initialDisplay.current) || countingEnabled !== initialCounting.current;
  const cameraLabel = `CAM-${String(activeCam.id).padStart(3, "0")}`;
  const videoStatus =
    props.runtimeReady === false
      ? "Checking..."
      : counts.status === "degraded"
        ? "Degraded"
        : counts.status === "reconnecting"
          ? "Reconnecting"
          : counts.status === "starting" || props.isStarting
            ? "Starting"
            : counts.status === "connecting"
              ? "Connecting"
              : counts.running && !counts.error
                ? "Live"
                : activeCam.status === "online"
                  ? "Connected"
                  : activeCam.status;
  const isLive = videoStatus === "Live";
  const ready = counts.running && previewState === "live" && (detections.frame_width ?? 0) > 0 && (detections.frame_height ?? 0) > 0;
  const zoneError = editorForm?.analysisMode === "open_space" ? (editorForm.openSpace ? validateOpenSpace(editorForm.openSpace) : "Draw a monitored area first.") : null;
  const zoneAfterDeletion = editorForm?.openSpace && selectedZonePoint !== null ? deleteZonePoint(editorForm.openSpace, selectedZonePoint) : null;
  const cancelSettings = () => {
    if (!busy) {
      if (dirty) setDiscard("settings");
      else onCancelEdit();
    }
  };
  const pendingNavigation = useRef<HTMLElement | null>(null);
  const bypassNavigation = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const closeRef = useRef(cancelSettings);
  closeRef.current = cancelSettings;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="listbox"]')) {
        event.preventDefault();
        closeRef.current();
      }
    };
    const navigate = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-topbar-navigation], [data-account-navigation], nav[aria-label="Enterprise mobile navigation"] button, a[href]',
      );
      if (!target || !dirtyRef.current || bypassNavigation.current || target.getAttribute("data-topbar-navigation") === "cameras") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingNavigation.current = target;
      setDiscard("settings");
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("keydown", keydown);
    document.addEventListener("click", navigate, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.removeEventListener("click", navigate, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const changeMode = (mode: "open_space" | "entrance_exit") => {
    if (editForm.analysisMode === "open_space") rememberedArea.current = editForm.openSpace;
    onEditFormChange(mode === "open_space" ? { ...editForm, analysisMode: "open_space", openSpace: rememberedArea.current ?? null } : { ...editForm, analysisMode: "entrance_exit", openSpace: null });
  };
  const openEditor = () => {
    const draft = structuredClone(editForm);
    if (draft.analysisMode === "open_space" && !draft.openSpace?.polygon.length) draft.openSpace = centeredZone(draft.openSpace);
    editorInitial.current = structuredClone(draft);
    editorHistory.current = [];
    setSelectedZonePoint(null);
    setEditorForm(draft);
  };
  const checkpoint = () => {
    if (editorForm) editorHistory.current.push(structuredClone(editorForm));
  };
  const updateEditor: Dispatch<SetStateAction<Camera | null>> = (next) => setEditorForm((current) => (typeof next === "function" ? next(current) : next));
  const changeZone = (openSpace: OpenSpaceSettings) => {
    if (editorForm?.analysisMode !== "open_space") return;
    if (JSON.stringify(openSpace) === JSON.stringify(editorForm.openSpace)) return;
    checkpoint();
    setEditorForm({ ...editorForm, openSpace });
    setSelectedZonePoint(null);
  };
  const removeZonePoint = () => {
    if (zoneAfterDeletion) changeZone(zoneAfterDeletion);
  };
  const undoEditor = () => {
    let previous = editorHistory.current.pop();
    while (previous && JSON.stringify(previous) === JSON.stringify(editorForm)) previous = editorHistory.current.pop();
    if (previous) {
      setSelectedZonePoint(null);
      setEditorForm(previous);
    }
  };
  const cancelEditor = () => {
    if (JSON.stringify(editorForm) !== JSON.stringify(editorInitial.current)) setDiscard("editor");
    else setEditorForm(null);
  };
  const reconnect = async () => {
    setReconnecting(true);
    setFeedback(null);
    try {
      const stopped = counts.running ? await props.onStopProcessing() : true;
      if (stopped !== true) throw new Error("Unable to stop this camera. Check the service status and try again.");
      const started = await props.onStartProcessing();
      if (started === false) throw new Error("The camera could not reconnect. Check its connection settings and service status.");
      setFeedback({ error: false, message: "Reconnect requested. The camera status will update when video returns." });
    } catch (issue) {
      setFeedback({ error: true, message: messageOf(issue) });
    } finally {
      setReconnecting(false);
    }
  };
  const testConnection = async () => {
    const issue = validateCameraConnection(editForm);
    if (issue) {
      setFeedback({ error: true, message: issue });
      return;
    }
    setTesting(true);
    setFeedback(null);
    try {
      const status = await getMlServiceStatus();
      const result = await testCameraConnection(status.baseUrl, editForm, storageKey, { draft: true });
      // Keep the stream address that answered; it is saved with the other changes.
      if (result.ok && result.stream_url && result.stream_url !== editForm.rtsp) onEditFormChange({ ...editForm, rtsp: result.stream_url });
      setFeedback({ error: !result.ok, message: result.ok ? "Camera connection verified with these settings. Changes have not been saved." : result.message });
    } catch (issue) {
      setFeedback({ error: true, message: messageOf(issue) });
    } finally {
      setTesting(false);
    }
  };
  const runDiagnostics = async () => {
    setDiagnosing(true);
    setFeedback(null);
    setDiagnosticResult(null);
    try {
      const status = await getMlServiceStatus();
      const [service, runtime] = await Promise.all([getMlHealth(status.baseUrl), getMlCameraStates(status.baseUrl)]);
      const camera = runtime.cameras.find((value) => value.camera_id === activeCam.id);
      setDiagnosticResult([
        `Camera: ${activeCam.name} (${cameraLabel})`,
        `Local service: ${service.status} · API ${service.api_contract_version} · ML ${service.service_version}`,
        `Video connection: ${camera?.counts.status ?? "Not processing"}`,
        `AI model: ${camera?.health.model_ready ? "Ready" : camera?.health.model_loading ? "Loading" : "Standby"}`,
        `Raw frame age: ${camera?.health.raw_frame_stale_ms == null ? "Unavailable" : `${Math.round(camera.health.raw_frame_stale_ms)} ms`}`,
        ...(camera?.counts.error ? [`Camera issue: ${camera.counts.error}`] : []),
      ]);
      setFeedback({ error: false, message: "Diagnostics retrieved from the local camera service." });
    } catch (issue) {
      setFeedback({ error: true, message: messageOf(issue) });
    } finally {
      setDiagnosing(false);
    }
  };
  const save = async () => {
    if (editForm.name.trim().length < 2 || editForm.name.trim().length > 120) {
      setValidation("Enter a camera name between 2 and 120 characters.");
      setTab("information");
      requestAnimationFrame(() => document.getElementById("settings-camera-name")?.focus());
      return;
    }
    if (editForm.zone.length > 120) {
      setValidation("Camera location must be 120 characters or fewer.");
      setTab("information");
      return;
    }
    setValidation(null);
    setSaving(true);
    let previousDisplay: string | null = null;
    let displayWritten = false;
    let configurationSaved = false;
    try {
      // Verify preference storage before committing the backend configuration.
      previousDisplay = localStorage.getItem(displayKey);
      localStorage.setItem(displayKey, JSON.stringify(display));
      displayWritten = true;
      configurationSaved = (await onSave(countingEnabled)) === true;
      if (configurationSaved) onCancelEdit();
    } catch (issue) {
      setValidation(messageOf(issue));
      notifyError("Camera settings could not be saved. Please try again.");
    } finally {
      if (displayWritten && !configurationSaved) {
        try {
          if (previousDisplay === null) localStorage.removeItem(displayKey);
          else localStorage.setItem(displayKey, previousDisplay);
        } catch {
          notifyWarning("Previous camera display settings could not be restored. Check them before leaving Camera Setup.");
        }
      }
      setSaving(false);
    }
  };
  return (
    <section className="camera-settings design-card" aria-label="Camera Settings">
      <header className="camera-settings-heading">
        <div>
          <span>SELECTED CAMERA ONLY</span>
          <h1>Camera Settings</h1>
          <p>Update how this camera is configured.</p>
        </div>
        <button type="button" className="design-icon-button" aria-label="Close Camera Settings" disabled={busy} onClick={cancelSettings}>
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <div className="camera-settings-identity">
        <span ref={identityIconRef} className="camera-settings-identity-icon" aria-hidden="true">
          <Video size={20} />
        </span>
        <div>
          <h2 ref={identityTitleRef}>{activeCam.name}</h2>
          <p>
            {cameraLabel} · {activeCam.zone || "No location assigned"}
          </p>
        </div>
        <span className={`camera-status ${isLive ? "is-live" : ""}`} role="status">
          {videoStatus}
        </span>
      </div>
      <div className="camera-settings-body">
        <nav role="tablist" aria-label="Camera settings tabs" aria-orientation="vertical">
          {tabs.map(({ id, label, icon: Icon }, index) => (
            <button
              type="button"
              role="tab"
              id={`camera-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`camera-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              key={id}
              onClick={() => {
                setTab(id);
                setFeedback(null);
              }}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowDown"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowUp"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  setTab(tabs[next].id);
                  document.getElementById(`camera-tab-${tabs[next].id}`)?.focus();
                }
              }}
            >
              {tab === id && (
                <motion.span
                  className="camera-settings-tab-indicator"
                  aria-hidden="true"
                  layoutId={`camera-settings-tab-indicator-${activeCam.id}`}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 0.9 }}
                />
              )}
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div key={tab} role="tabpanel" id={`camera-panel-${tab}`} aria-labelledby={`camera-tab-${tab}`} className={`camera-settings-content settings-${tab}`} tabIndex={0}>
          {validation && (
            <p className="camera-settings-error" role="alert">
              {validation}
            </p>
          )}
          {props.error && (
            <p className="camera-settings-error" role="alert">
              {props.error}
            </p>
          )}
          {feedback && (
            <p className={feedback.error ? "camera-settings-error" : "camera-settings-success"} role={feedback.error ? "alert" : "status"}>
              {feedback.message}
            </p>
          )}
          {tab === "information" && (
            <>
              <SectionHeading title="Camera Information" description="Name your camera and specify where it is installed." />
              <Field label="Camera Name" htmlFor="settings-camera-name" required>
                <input
                  id="settings-camera-name"
                  aria-label="Camera Name"
                  required
                  aria-required="true"
                  maxLength={120}
                  value={editForm.name}
                  onChange={(event) => onEditFormChange({ ...editForm, name: event.target.value })}
                />
              </Field>
              <Field label="Camera Brand" required>
                <SelectDropdown
                  reportsDismissal
                  value={editForm.cameraBrand ?? "tapo"}
                  options={CAMERA_BRANDS}
                  ariaLabel="Camera brand / type"
                  onChange={(brand) => onEditFormChange({ ...editForm, ...updateCameraConnection(editForm, { cameraBrand: brand as Camera["cameraBrand"] }) })}
                />
              </Field>
              <Field label="Camera Location (optional)" htmlFor="settings-location">
                <input
                  id="settings-location"
                  aria-label="Camera Location"
                  maxLength={120}
                  value={editForm.zone}
                  placeholder="Enter the location of your camera"
                  onChange={(event) => onEditFormChange({ ...editForm, zone: event.target.value })}
                />
                <small>Example: Main Gate, Lobby, or Park</small>
              </Field>
              <Field label={CAMERA_MODE_LABEL} required>
                <SelectDropdown
                  reportsDismissal
                  ariaLabel={CAMERA_MODE_LABEL}
                  value={editForm.analysisMode ?? "entrance_exit"}
                  options={CAMERA_MODE_OPTIONS}
                  onChange={(mode) => changeMode(mode as "open_space" | "entrance_exit")}
                />
                <small>{cameraModeDescription(editForm.analysisMode)}</small>
              </Field>
            </>
          )}
          {tab === "connection" && (
            <>
              <SectionHeading title="Camera Connection" description="Enter the camera's IP address and its own username and password." />
              <p className="connection-status">
                <b>Current Connection</b>
                <span>
                  {isLive ? "● " : ""}
                  {videoStatus}
                </span>
              </p>
              <CameraConnectionFields value={editForm} hostError={props.cameraIpError} readOnly={busy} onChange={(connection) => onEditFormChange({ ...editForm, ...connection })} />
              <Field label="Camera Username" htmlFor="settings-username">
                <input
                  id="settings-username"
                  autoComplete="username"
                  value={editForm.username ?? ""}
                  readOnly={busy}
                  placeholder="Enter camera username"
                  onChange={(event) => onEditFormChange({ ...editForm, username: event.target.value })}
                />
              </Field>
              <Field label="Camera Password" htmlFor="settings-camera-password">
                <PasswordVisibilityInput id="settings-camera-password" variant="modal" autoComplete="new-password" readOnly={busy}
                  value={editForm.password ?? ""} placeholder="Enter new password (optional)" onChange={(password) => onEditFormChange({ ...editForm, password })} />
                {hasStoredPassword && <small>Password configured. Leave blank to keep it unchanged.</small>}
              </Field>
              <button className="design-button full-width" type="button" disabled={busy || props.isTesting} onClick={() => void testConnection()}>
                {testing ? "Testing connection…" : "Test Camera Connection"}
              </button>
              <p className="design-note">TANAW finds the best video stream for counting. Testing does not save changes or interrupt counting.</p>
            </>
          )}
          {tab === "counting" && (
            <>
              <SectionHeading title="Visitor Counting" description="Choose how this camera counts people in its view." />
              <DesignSwitch
                label="Enable Visitor Counting"
                description="Detect and count people using this camera."
                checked={countingEnabled}
                disabled={props.runtimeReady === false}
                onChange={setCountingEnabled}
              />
              <h3 className="settings-subheading">{CAMERA_MODE_LABEL}</h3>
              <div className="counting-methods" role="radiogroup" aria-label={CAMERA_MODE_LABEL}>
                {CAMERA_MODE_OPTIONS.map(([mode]) => (
                  <label key={mode} className={`counting-method ${(editForm.analysisMode ?? "entrance_exit") === mode ? "selected" : ""}`}>
                    <input type="radio" name="counting-method" value={mode} checked={(editForm.analysisMode ?? "entrance_exit") === mode} onChange={() => changeMode(mode)} />
                    <span>
                      <strong>{cameraModeName(mode)}</strong>
                      <p>{cameraModeDescription(mode)}</p>
                    </span>
                  </label>
                ))}
              </div>
              <p className="design-note">{CAMERA_PLACEMENT_NOTE}</p>
              <SectionHeading title="Monitored Area" description="Choose where this camera should count people." />
              <button className="design-button full-width" type="button" onClick={openEditor}>
                <Pencil size={17} aria-hidden="true" /> Edit Counting Area
              </button>
              <p className="design-note">Test your area after changing it. Changes apply to this camera when you save.</p>
            </>
          )}
          {tab === "display" && (
            <>
              <SectionHeading title="Camera Display" description="Choose what appears on this camera's preview. These controls do not change the AI counting rules." />
              <DesignSwitch label="Show Detected People" description="Display boxes around detected people." checked={display.people} onChange={(people) => setDisplay({ ...display, people })} />
              <DesignSwitch label="Show Counting Area" description="Display the boundary of the monitored area." checked={display.area} onChange={(area) => setDisplay({ ...display, area })} />
              <p className="settings-display-note">
                <Info size={18} aria-hidden="true" />
                These display preferences apply to {activeCam.name} only.
              </p>
            </>
          )}
          {tab === "maintenance" && (
            <>
              <SectionHeading title="Camera Maintenance" description="Tools for troubleshooting this particular camera." />
              <dl className="maintenance-status">
                <div>
                  <dt>Selected Camera</dt>
                  <dd>{cameraLabel}</dd>
                </div>
                <div>
                  <dt>Video Connection</dt>
                  <dd>{videoStatus}</dd>
                </div>
                <div>
                  <dt>AI Counting</dt>
                  <dd>{counts.running && health?.model_ready && !counts.error ? "Active" : props.isStarting || health?.model_loading ? "Starting" : counts.running ? "Waiting" : "Stopped"}</dd>
                </div>
              </dl>
              <h3 className="settings-subheading">Troubleshooting</h3>
              <div className="maintenance-actions">
                <button className="design-button" type="button" disabled={busy || props.isStarting} onClick={() => void reconnect()}>
                  {reconnecting ? "Reconnecting…" : "Reconnect Camera"}
                </button>
                <button className="design-button" type="button" disabled={busy} onClick={() => void runDiagnostics()}>
                  {diagnosing ? "Running Diagnostics…" : "Run Diagnostics"}
                </button>
              </div>
              {diagnosing && !diagnosticResult && (
                <div className="camera-diagnostics camera-diagnostics--loading" aria-hidden="true">
                  <SkeletonText lines={5} />
                </div>
              )}
              {diagnosticResult && (
                <ul className="camera-diagnostics" aria-label="Camera diagnostics">
                  {diagnosticResult.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary>Service diagnostics and controls</summary>
                <CameraMonitoringPanel {...props} previewState={previewState} />
              </details>
              <h3 className="settings-subheading">Reset this camera</h3>
              <p>Restore this camera's counting configuration. Connection details remain saved.</p>
              <button type="button" className="design-button danger-button" disabled={busy} onClick={() => setResetPrompt(true)}>
                Restore Camera Defaults
              </button>
              <div className="camera-danger-zone">
                <h3>Remove Camera</h3>
                <p>Remove {activeCam.name} and stop its visitor counting. Other cameras are unaffected.</p>
                <button className="design-button danger-button" type="button" disabled={busy} onClick={props.onDelete}>
                  Remove Camera
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <footer className="camera-settings-footer">
        <p>
          Settings apply to <b>{cameraLabel}</b> only.
        </p>
        <div>
          <button type="button" className="design-button" disabled={busy} onClick={cancelSettings}>
            Cancel
          </button>
          <button type="button" className="design-button primary" disabled={busy || props.runtimeReady === false || Boolean(props.cameraIpError)} onClick={() => void save()}>
            {saving || props.isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </footer>
      {editorForm && (
        <CameraDialog
          title="Edit Counting Area"
          description={editorForm.analysisMode === "open_space" ? "Adjust the area of the live video you want to monitor." : "Drag the Entry and Exit lines to set where visitors are counted."}
          className="camera-area-dialog"
          onClose={cancelEditor}
          onKeyDown={(event) => {
            if (editorForm.analysisMode !== "open_space" || selectedZonePoint === null || (event.key !== "Delete" && event.key !== "Backspace")) return;
            event.preventDefault();
            if (!event.repeat) removeZonePoint();
          }}
          footer={
            <>
              <button
                className="design-button"
                type="button"
                disabled={editorHistory.current.length === 0}
                onClick={undoEditor}
              >
                Undo
              </button>
              <button
                className="design-button primary"
                type="button"
                disabled={Boolean(zoneError)}
                onClick={() => {
                  onEditFormChange(editorForm);
                  setEditorForm(null);
                }}
              >
                Use this Area
              </button>
            </>
          }
        >
          <div className={`counting-editor-preview ${editorForm.analysisMode === "open_space" ? "counting-editor-preview--zone" : ""}`}>
            <CameraVideoPreview
              area={area}
              activeCam={activeCam}
              counts={counts}
              detections={detections}
              editForm={editorForm}
              health={health}
              isProcessing={counts.running}
              isEditMode
              onEditFormChange={updateEditor}
              onEditCheckpoint={checkpoint}
              selectedZonePoint={selectedZonePoint}
              onSelectZonePoint={setSelectedZonePoint}
              onPreviewStateChange={setPreviewState}
              streamUrl={streamUrl}
              displayPreferences={display}
              onRetry={props.onStartProcessing}
            />
          </div>
          {editorForm.analysisMode === "open_space" && (
            <OpenSpaceZoneControls
              pointCount={editorForm.openSpace?.polygon.length ?? 0}
              previewReady={ready}
              selectedPoint={selectedZonePoint}
              canDelete={Boolean(zoneAfterDeletion)}
              error={zoneError}
              onDelete={removeZonePoint}
              onClear={() => changeZone(withZonePolygon(editorForm.openSpace, []))}
              onReset={() => changeZone(centeredZone(editorForm.openSpace))}
            />
          )}
          {!counts.running && (
            <button className="design-button" type="button" disabled={props.isStarting} onClick={props.onStartProcessing}>
              {props.isStarting ? "Starting…" : "Start camera preview"}
            </button>
          )}
        </CameraDialog>
      )}
      {resetPrompt && (
        <CameraDialog
          title="Restore Camera Defaults"
          description={`Restore counting defaults for ${activeCam.name}?`}
          onClose={() => setResetPrompt(false)}
          className="camera-confirm-dialog"
          footer={
            <>
              <button type="button" className="design-button" onClick={() => setResetPrompt(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="design-button danger-button"
                onClick={() => {
                  onEditFormChange({
                    ...editForm,
                    ...FIXED_DETECTION_SETTINGS,
                    config: { tripwire: 50, reverse: false, roi: { ...DEFAULT_ROI }, tripwires: getDefaultTripwires(50) },
                    openSpace: null,
                  });
                  rememberedArea.current = null;
                  setResetPrompt(false);
                }}
              >
                Restore Defaults
              </button>
            </>
          }
        >
          <p>This resets this camera's monitored area and processing settings when you save changes. Its connection and other cameras are unaffected.</p>
        </CameraDialog>
      )}
      {discard && (
        <CameraDialog
          title="Discard unsaved changes?"
          description={discard === "editor" ? "Your counting area edits have not been applied." : `Your changes to ${activeCam.name} have not been saved.`}
          className="camera-confirm-dialog"
          onClose={() => {
            pendingNavigation.current = null;
            setDiscard(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="design-button"
                onClick={() => {
                  pendingNavigation.current = null;
                  setDiscard(null);
                }}
              >
                Keep Editing
              </button>
              <button
                type="button"
                className="design-button danger-button"
                onClick={() => {
                  if (discard === "editor") setEditorForm(null);
                  else {
                    bypassNavigation.current = true;
                    onCancelEdit();
                    const target = pendingNavigation.current;
                    requestAnimationFrame(() => target?.isConnected && target.click());
                  }
                  setDiscard(null);
                }}
              >
                Discard Changes
              </button>
            </>
          }
        >
          <p>The saved camera configuration will be kept.</p>
        </CameraDialog>
      )}
    </section>
  );
}
function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="settings-section-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}
function Field({ label, required, children, htmlFor }: { label: string; required?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="settings-field">
      <label htmlFor={htmlFor}>
        {label}
        {required && <em aria-hidden="true"> *</em>}
      </label>
      {children}
    </div>
  );
}
function messageOf(issue: unknown) {
  return issue instanceof Error ? issue.message : "The camera service is unavailable. Try again.";
}
