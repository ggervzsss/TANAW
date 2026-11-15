import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CameraDialog } from "./CameraDialog";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { CAMERA_BRANDS, updateCameraConnection } from "../utils/camera-connection";
import type { CameraFormValues } from "../types/camera";
import { validateCameraForm } from "../utils/camera-form-validation";
import { PasswordVisibilityInput } from "./PasswordVisibilityInput";
import { CameraConnectionFields } from "./CameraConnectionFields";
import { CAMERA_MODE_LABEL, CAMERA_MODE_OPTIONS, cameraModeDescription } from "../utils/camera-mode";

type CameraAddModalProps = {
  newCam: CameraFormValues;
  isValidating: boolean;
  errors: Partial<Record<keyof CameraFormValues, string>>;
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
  const shownErrors = { ...(submitted ? formErrors : {}), ...errors };
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
        <form id="camera-add-form" onSubmit={submit} noValidate>
          <div hidden={step !== "information"}>
            <Field id="camera-name" label="Camera Name" required error={shownErrors.name}>
              <input
                id="camera-name"
                required
                aria-required="true"
                aria-invalid={Boolean(shownErrors.name)}
                maxLength={120}
                value={newCam.name}
                onChange={(event) => onChange({ ...newCam, name: event.target.value })}
              />
            </Field>
            <Field label="Camera Brand" required>
              <SelectDropdown
                reportsDismissal
                value={newCam.cameraBrand ?? "tapo"}
                ariaLabel="Camera brand / type"
                options={CAMERA_BRANDS}
                onChange={(brand) =>
                  onChange({ ...newCam, ...updateCameraConnection(newCam, { cameraBrand: brand as CameraFormValues["cameraBrand"] }), cameraHost: newCam.cameraHost })
                }
              />
            </Field>
            <Field id="camera-zone" label="Camera Location (optional)" error={shownErrors.zone}>
              <input id="camera-zone" maxLength={120} value={newCam.zone} placeholder="Enter the location of your camera" onChange={(event) => onChange({ ...newCam, zone: event.target.value })} />
              <small>Example: Main Gate, Lobby, or Park</small>
            </Field>
            <Field label={CAMERA_MODE_LABEL} required>
              <SelectDropdown
                reportsDismissal
                ariaLabel={CAMERA_MODE_LABEL}
                value={newCam.analysisMode ?? "entrance_exit"}
                options={CAMERA_MODE_OPTIONS}
                onChange={(mode) => onChange({ ...newCam, analysisMode: mode as CameraFormValues["analysisMode"] })}
              />
              <small>{cameraModeDescription(newCam.analysisMode)}</small>
            </Field>
          </div>
          <div hidden={step !== "connection"} className="camera-add-connection">
            <CameraConnectionFields
              value={newCam}
              hostError={shownErrors.cameraHost ?? duplicateIpError}
              streamError={shownErrors.rtsp}
              onChange={(connection) => onChange({ ...newCam, ...connection, cameraHost: connection.cameraHost ?? "" })}
            />
            <Field id="camera-username" label="Camera Username" required error={shownErrors.username}>
              <input
                id="camera-username"
                autoComplete="username"
                required
                aria-required="true"
                aria-invalid={Boolean(shownErrors.username)}
                value={newCam.username}
                onChange={(event) => onChange({ ...newCam, username: event.target.value })}
              />
            </Field>
            <Field id="camera-password" label="Camera Password" required error={shownErrors.password}>
              <PasswordVisibilityInput id="camera-password" variant="modal" autoComplete="new-password" ariaRequired
                hasError={Boolean(shownErrors.password)} value={newCam.password} onChange={(password) => onChange({ ...newCam, password })} />
            </Field>
            <p className="design-note">The camera is added only after its connection is verified. Credentials are kept in the desktop's secure credential store.</p>
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
function Field({ id, label, required, error, children }: { id?: string; label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>
        {label}
        {required && <em aria-hidden="true"> *</em>}
      </label>
      {children}
      {error && (
        <p className="camera-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
