import { Copy, Download, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { Button, Dialog, Skeleton } from "@/shared/ui-kit";
import { SettingsNote } from "@/shared/ui-kit/patterns/GeneralSettings";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { formatPhilippineDateAndTime } from "@/shared/utils/dateTime";
import { isCompleteAuthenticatorCode, normalizeAuthenticatorCode } from "@/shared/utils/twoFactorCodes";
import { RECOVERY_CODES_FILE_NAME, formatAuthenticatorKey, recoveryCodesFileText } from "../model";
import { confirmTwoFactorSetup, startTwoFactorSetup, type TwoFactorSetup } from "../services";

type Step = "key" | "code" | "codes";

const titles: Record<Step, string> = {
  key: "Set up two-step verification",
  code: "Enter the code from your app",
  codes: "Save your recovery codes",
};

const descriptions: Record<Step, string> = {
  key: "Step 1 of 3. Add TANAW to an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.",
  code: "Step 2 of 3. Your app now shows a 6-digit code for TANAW that changes every 30 seconds.",
  codes: "Step 3 of 3. Two-step verification is on. If you lose your phone, each of these codes signs you in once.",
};

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Unable to copy. Select the text and copy it instead.");
  }
}

function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Turns on two-step verification in three steps: add the key, confirm a code, keep the recovery codes. */
export function TwoFactorSetupDialog({ onClose }: { onClose: () => void }) {
  const updateUser = useAuthStore((state) => state.updateUser);
  const email = useAuthStore((state) => state.user?.email ?? "");
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const [step, setStep] = useState<Step>("key");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [loadError, setLoadError] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [savedReminder, setSavedReminder] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef<HTMLInputElement>(null);
  const copyCodesRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const codeId = useId();
  const loadRequest = useRef(0);
  const started = useRef(false);

  // Each request replaces the pending key on the server, so only the newest answer is shown.
  const requestKey = useCallback(() => {
    const request = ++loadRequest.current;
    startTwoFactorSetup()
      .then((next) => {
        if (request === loadRequest.current) setSetup(next);
      })
      .catch((error: unknown) => {
        if (request === loadRequest.current) setLoadError(getApiErrorMessage(error, "Unable to start the setup. Try again."));
      });
  }, []);

  // One key per opening, even when development mode runs effects twice.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    requestKey();
  }, [requestKey]);

  const retryKey = () => {
    setLoadError("");
    setSetup(null);
    requestKey();
  };

  useEffect(() => {
    // Each step starts where the person acts next; the button they pressed is gone.
    if (step === "code") codeInputRef.current?.focus();
    if (step === "codes") copyCodesRef.current?.focus();
  }, [step]);

  const close = () => {
    if (isConfirming) return;
    if (step === "codes" && !saved) {
      setSavedReminder(true);
      savedRef.current?.focus();
      return;
    }
    onClose();
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isConfirming) return;
    if (!isCompleteAuthenticatorCode(code)) {
      setCodeError("Enter the 6-digit code from your authenticator app.");
      codeInputRef.current?.focus();
      return;
    }
    setIsConfirming(true);
    setCodeError("");
    try {
      const result = await confirmTwoFactorSetup(code);
      updateUser(result.user);
      setRecoveryCodes(result.recoveryCodes);
      setStep("codes");
      toast.success("Two-step verification is on.");
    } catch (error) {
      setCode("");
      setCodeError(getApiErrorMessage(error, "Unable to check the code. Try again."));
      window.requestAnimationFrame(() => codeInputRef.current?.focus());
    } finally {
      setIsConfirming(false);
    }
  };

  const fileText = () => recoveryCodesFileText(recoveryCodes, { email, savedOn: formatPhilippineDateAndTime(new Date(), dateFormat, timeFormat) });

  const footer =
    step === "key" ? (
      <>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button disabled={!setup} onClick={() => setStep("code")}>
          Next
        </Button>
      </>
    ) : step === "code" ? (
      <>
        <Button variant="secondary" disabled={isConfirming} onClick={() => setStep("key")}>
          Back
        </Button>
        <Button type="submit" form={formId} loading={isConfirming}>
          Turn on 2FA
        </Button>
      </>
    ) : (
      <Button disabled={!saved} onClick={onClose}>
        Done
      </Button>
    );

  return (
    <Dialog title={titles[step]} description={descriptions[step]} accent="thread" size="md" onClose={close} closeOnBackdrop={step === "key" && !isConfirming} footer={footer}>
      {step === "key" && (
        <div className="tanaw-two-factor-steps">
          <ol>
            <li>Open your authenticator app and choose to add an account.</li>
            <li>Pick the option to enter a setup key, and use this key. Name the account TANAW and keep it time-based.</li>
          </ol>
          {loadError ? (
            <SettingsNote tone="danger">
              {loadError}{" "}
              <Button variant="link" size="sm" onClick={retryKey}>
                Try again
              </Button>
            </SettingsNote>
          ) : setup ? (
            <>
              <div className="tanaw-two-factor-key">
                <code aria-label="Setup key">{formatAuthenticatorKey(setup.secret)}</code>
                <Button variant="secondary" size="sm" leadingIcon={<Copy size={15} aria-hidden="true" />} onClick={() => void copyText(setup.secret, "Setup key copied.")}>
                  Copy key
                </Button>
              </div>
              <p>
                On this phone or a computer with an authenticator app, you can also{" "}
                <a className="tanaw-two-factor-link" href={setup.otpauthUri}>
                  open the setup link
                </a>{" "}
                to add TANAW in one step.
              </p>
            </>
          ) : (
            <Skeleton className="rounded-tanaw-md h-13 w-full" label="Getting your setup key" />
          )}
        </div>
      )}

      {step === "code" && (
        <form id={formId} noValidate onSubmit={confirm} className="tanaw-two-factor-steps">
          <div className="tanaw-account-field">
            <label htmlFor={codeId} className="tanaw-account-field-label">
              6-digit code
            </label>
            <input
              ref={codeInputRef}
              id={codeId}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              spellCheck={false}
              placeholder="123456"
              value={code}
              disabled={isConfirming}
              onChange={(event) => {
                setCode(normalizeAuthenticatorCode(event.target.value));
                setCodeError("");
              }}
              aria-invalid={Boolean(codeError)}
              aria-describedby={codeError ? `${codeId}-error` : undefined}
              className="tanaw-account-field-input tanaw-two-factor-code-input"
            />
            {codeError ? (
              <span id={`${codeId}-error`} role="alert" className="tanaw-account-field-error">
                {codeError}
              </span>
            ) : null}
          </div>
          <p>Enter the code your app shows now. If it changes while you type, use the new one.</p>
        </form>
      )}

      {step === "codes" && (
        <div className="tanaw-two-factor-steps">
          <ol className="tanaw-recovery-codes" aria-label="Recovery codes">
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ol>
          <p>These codes are shown only now. Keep them somewhere safe and private, apart from your phone.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={copyCodesRef}
              variant="secondary"
              size="sm"
              leadingIcon={<Copy size={15} aria-hidden="true" />}
              onClick={() => void copyText(recoveryCodes.join("\n"), "Recovery codes copied.")}
            >
              Copy codes
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Download size={15} aria-hidden="true" />}
              onClick={() => {
                downloadText(RECOVERY_CODES_FILE_NAME, fileText());
                toast.success("Recovery codes downloaded.");
              }}
            >
              Download .txt
            </Button>
          </div>
          <label className="tanaw-two-factor-check">
            <input
              ref={savedRef}
              type="checkbox"
              checked={saved}
              onChange={(event) => {
                setSaved(event.target.checked);
                setSavedReminder(false);
              }}
            />
            I saved these codes
          </label>
          {savedReminder && !saved ? (
            <SettingsNote tone="info">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={15} aria-hidden="true" />
                Save the codes, then tick “I saved these codes” to finish.
              </span>
            </SettingsNote>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
