import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CameraDialog } from "./CameraDialog";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { CAMERA_BRANDS, updateCameraConnection } from "../utils/camera-connection";
import type { CameraFormValues } from "../types/camera";
import { validateCameraForm, type CameraFormErrors } from "../utils/camera-form-validation";
import { cameraErrorFocusTarget, type CameraErrorFocusTarget } from "../utils/camera-connection-errors";
import { PasswordVisibilityInput } from "./PasswordVisibilityInput";
import { CameraConnectionFields } from "./CameraConnectionFields";
import { CAMERA_MODE_LABEL, CAMERA_MODE_OPTIONS, CAMERA_PLACEMENT_NOTE, cameraModeDescription } from "../utils/camera-mode";

type CameraAddModalProps = {
  newCam: CameraFormValues;
  isValidating: boolean;
  errors: CameraFormErrors;
  duplicateIpError?: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (values: CameraFormValues) => void;
};
export function CameraAddModal({ newCam, isValidating, errors, duplicateIpError, onClose, onSubmit, onChange }: CameraAddModalProps) {
  const [step, setStep] = useState<"information" | "connection">("information");
  const initial = useRef(JSON.stringify(newCam));
  const [discard, setDiscard] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formErrors = validateCameraForm(newCam);
  const shownErrors: CameraFormErrors = { ...(submitted ? formErrors : {}), ...errors };
  const passwordError = shownErrors.password ?? shownErrors.credentials;
  const formRef = useRef<HTMLFormElement>(null);
  const previousErrors = useRef(errors);
  useEffect(() => {
    // After a failed attempt, focus the field to fix; clearing an error as the user types moves nothing.
    const added = Object.keys(errors).some((key) => !(key in previousErrors.current));
    previousErrors.current = errors;
    const target = cameraErrorFocusTarget(errors);
    if (added && target && step === "connection") formRef.current?.querySelector<HTMLElement>(FOCUS_SELECTORS[target])?.focus();
  }, [errors, step]);
  const requestClose = () => {
    if (isValidating) return;
    if (JSON.stringify(newCam) !== initial.current) setDiscard(true);
    else onClose();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (step === "information") {
      if (formErrors.name || formErrors.zone) return;
      setStep("connection");
      setSubmitted(false);
    } else {
      onSubmit(event);
    }
  };
  return (
    <>
      <CameraDialog
        title={step === "information" ? "Camera Information" : "Camera Connection"}
        description={step === "information" ? "Name your camera and specify where it is installed." : `Connect ${newCam.name || "your camera"} to verify its video stream.`}
        className="camera-add-dialog"
        onClose={requestClose}
        busy={isValidating}
        footer={
          <>
            {step === "connection" && (
              <button className="design-button camera-add-back" type="button" disabled={isValidating} onClick={() => setStep("information")}>
                Back
              </button>
            )}
            <button className="design-button" type="button" disabled={isValidating} onClick={requestClose}>
              Cancel
            </button>
            <button className="design-button primary" type="submit" form="camera-add-form" disabled={isValidating || (step === "connection" && Boolean(duplicateIpError))}>
              {isValidating ? "Testing Camera…" : step === "information" ? "Add Camera" : "Test & Add Camera"}
            </button>
          </>
        }
      >
        <form id="camera-add-form" ref={formRef} onSubmit={submit} noValidate>
          <div hidden={step !== "information"}>
            <Field id="camera-name" label="Camera Name" required error={shownErrors.name}>
              <input
                id="camera-name"
                required
                aria-required="true"
                aria-invalid={Boolean(shownErrors.name)}
                maxLength={120}
                readOnly={isValidating}
                value={newCam.name}
                onChange={(event) => onChange({ ...newCam, name: event.target.value })}
              />
            </Field>
            <Field label="Camera Brand" required>
              <SelectDropdown
                reportsDismissal
                value={newCam.cameraBrand ?? "tapo"}
                ariaLabel="Camera brand / type"
                menuClassName="camera-add-dropdown"
                disabled={isValidating}
                options={CAMERA_BRANDS}
                onChange={(brand) =>
                  onChange({ ...newCam, ...updateCameraConnection(newCam, { cameraBrand: brand as CameraFormValues["cameraBrand"] }), cameraHost: newCam.cameraHost })
                }
              />
            </Field>
            <Field id="camera-zone" label="Camera Location (optional)" error={shownErrors.zone}>
              <input id="camera-zone" maxLength={120} readOnly={isValidating} value={newCam.zone} placeholder="Enter the location of your camera" onChange={(event) => onChange({ ...newCam, zone: event.target.value })} />
              <small>Example: Main Gate, Lobby, or Park</small>
            </Field>
            <Field label={CAMERA_MODE_LABEL} required>
              <SelectDropdown
                reportsDismissal
                ariaLabel={CAMERA_MODE_LABEL}
                menuClassName="camera-add-dropdown"
                disabled={isValidating}
                value={newCam.analysisMode ?? "entrance_exit"}
                options={CAMERA_MODE_OPTIONS}
                onChange={(mode) => onChange({ ...newCam, analysisMode: mode as CameraFormValues["analysisMode"] })}
              />
              <small>
                {cameraModeDescription(newCam.analysisMode)} {CAMERA_PLACEMENT_NOTE}
              </small>
            </Field>
          </div>
          <div hidden={step !== "connection"} className="camera-add-connection">
            <div className="camera-add-address">
              <CameraConnectionFields
                value={newCam}
                hostError={shownErrors.cameraHost ?? duplicateIpError}
                streamError={shownErrors.rtsp}
                readOnly={isValidating}
                onChange={(connection) => onChange({ ...newCam, ...connection, cameraHost: connection.cameraHost ?? "" })}
              />
            </div>
            <Field id="camera-username" label="Camera Username" required error={shownErrors.username}>
              <input
                id="camera-username"
                autoComplete="username"
                required
                aria-required="true"
                aria-invalid={Boolean(shownErrors.username || shownErrors.credentials)}
                aria-describedby={shownErrors.username ? "camera-username-error" : shownErrors.credentials ? "camera-password-error" : undefined}
                value={newCam.username}
                readOnly={isValidating}
                onChange={(event) => onChange({ ...newCam, username: event.target.value })}
              />
            </Field>
            <Field id="camera-password" label="Camera Password" required error={passwordError}>
              <PasswordVisibilityInput id="camera-password" variant="modal" autoComplete="new-password" ariaRequired ariaDescribedBy={passwordError ? "camera-password-error" : undefined}
                hasError={Boolean(passwordError)} readOnly={isValidating} value={newCam.password} onChange={(password) => onChange({ ...newCam, password })} />
            </Field>
            <p className="design-note">The camera is added only after its connection is verified. Credentials are kept in the desktop's secure credential store.</p>
            {shownErrors.connection && (
              <p className="camera-settings-error camera-add-connection-error" role="alert" tabIndex={-1}>
                {shownErrors.connection}
              </p>
            )}
          </div>
        </form>
      </CameraDialog>
      {discard && (
        <CameraDialog
          title="Discard new camera?"
          description="This camera has not been added."
          className="camera-confirm-dialog"
          onClose={() => setDiscard(false)}
          footer={
            <>
              <button type="button" className="design-button" onClick={() => setDiscard(false)}>
                Keep Editing
              </button>
              <button type="button" className="design-button danger-button" onClick={onClose}>
                Discard Changes
              </button>
            </>
          }
        >
          <p>Your unsaved camera details will be discarded.</p>
        </CameraDialog>
      )}
    </>
  );
}
const FOCUS_SELECTORS: Record<CameraErrorFocusTarget, string> = {
  cameraHost: ".camera-add-address input",
  rtsp: ".camera-add-address input",
  username: "#camera-username",
  password: "#camera-password",
  connection: ".camera-add-connection-error",
};

function Field({ id, label, required, error, children }: { id?: string; label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>
        {label}
        {required && <em aria-hidden="true"> *</em>}
      </label>
      {children}
      {error && (
        <p id={id ? `${id}-error` : undefined} className="camera-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
