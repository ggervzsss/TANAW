import { ShieldCheck, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { SettingsSaveBar } from "@/shared/ui-kit/patterns/GeneralSettings";
import { useSettingsDraft } from "@/shared/ui-kit/lib/settingsDraft";
import { Alert, Button, ConfirmDialog, SegmentedControl, Select, Skeleton } from "@/shared/ui-kit";
import type { SystemDateFormat, SystemTimeFormat } from "@/shared/utils/dateTime";
import {
  CAMERA_WAIT_MINUTE_OPTIONS,
  changesLockout,
  cleanupText,
  dateFormatOptions,
  isSettingsDirty,
  lastChangedText,
  LOGIN_ATTEMPT_OPTIONS,
  LOGIN_LOCK_MINUTE_OPTIONS,
  RETENTION_DAY_OPTIONS,
  retentionLabel,
  timeFormatOptions,
  type ActivityCleanup,
  type SystemSettingsForm,
} from "../model";

const numberOptions = (values: readonly number[]) => values.map((value) => [String(value), String(value)] as const);
const linkButton = "font-semibold text-(--tanaw-accent-ink) underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)";

type SettingsTabProps = {
  saved: SystemSettingsForm | null;
  draft: SystemSettingsForm | null;
  onDraftChange: (draft: SystemSettingsForm) => void;
  onDiscard: () => void;
  onSave: () => void;
  isSaving: boolean;
  isLoading: boolean;
  isError: boolean;
  onReload: () => void;
  updatedAt: string | null;
  updatedBy: string | null;
  cleanup: ActivityCleanup | null;
  cleanupLoading: boolean;
  onRemoveOld: () => void;
  isRemoving: boolean;
  now: Date;
  /** The saved display formats, used for the cleanup and last-changed lines. */
  dateFormat: SystemDateFormat;
  timeFormat: SystemTimeFormat;
};

/** The rules every account follows, in one form with one Save settings button. */
export function SettingsTab(props: SettingsTabProps) {
  const { saved, draft, onDraftChange, onDiscard, onSave, isSaving, isLoading, isError, onReload, updatedAt, updatedBy, now, dateFormat, timeFormat } = props;
  const [confirm, setConfirm] = useState<"lockout" | "remove" | null>(null);
  const dirty = Boolean(saved && draft && isSettingsDirty(saved, draft));
  const draftMarker = useSettingsDraft(dirty);

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading the settings" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-12 gap-y-4 border-b border-(--tanaw-border-soft) pb-7 max-lg:grid-cols-1 ${index === 0 ? "pt-2" : "pt-7"}`}>
            <div>
              <span className="flex h-6.5 items-center">
                <Skeleton className="h-4.5 w-40" />
              </span>
              <span className="mt-1 flex h-5 items-center">
                <Skeleton className="h-3.5 w-4/5" />
              </span>
            </div>
            <Skeleton className="rounded-tanaw-md h-10 w-full max-w-sm" />
          </div>
        ))}
      </div>
    );
  }
  if (isError || !saved || !draft) {
    return (
      <Alert
        tone="danger"
        title="The settings could not be loaded."
        action={
          <button type="button" onClick={onReload} className={linkButton}>
            Try again
          </button>
        }
      />
    );
  }

  const set = <K extends keyof SystemSettingsForm>(key: K, value: SystemSettingsForm[K]) => onDraftChange({ ...draft, [key]: value });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || isSaving) return;
    if (changesLockout(saved, draft)) setConfirm("lockout");
    else onSave();
  };

  return (
    <form onSubmit={submit} data-settings-draft={draftMarker} className="[--settings-gutter:1rem] [--settings-line:var(--tanaw-border-soft)]" aria-label="System settings" noValidate>
      <SettingSection title="Sign-in lockout" description="Stops password guessing on every account, including enterprises." first>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 text-[0.9375rem] leading-relaxed text-(--tanaw-text)">
          <span aria-hidden="true">Lock after</span>
          <Select
            ariaLabel="Wrong passwords before an account locks"
            value={String(draft.loginAttemptLimit)}
            options={numberOptions(LOGIN_ATTEMPT_OPTIONS)}
            onChange={(value) => set("loginAttemptLimit", Number(value))}
            className="it-system__inline-select"
          />
          <span aria-hidden="true">wrong passwords, for</span>
          <Select
            ariaLabel="Minutes an account stays locked"
            value={String(draft.loginLockMinutes)}
            options={numberOptions(LOGIN_LOCK_MINUTE_OPTIONS)}
            onChange={(value) => set("loginLockMinutes", Number(value))}
            className="it-system__inline-select"
          />
          <span aria-hidden="true">minutes</span>
        </div>
      </SettingSection>

      <SettingSection title="Camera not counting" description="When to flag a camera on the Overview and the Admin dashboard. Only during opening hours.">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 text-[0.9375rem] leading-relaxed text-(--tanaw-text)">
          <span aria-hidden="true">Flag a camera after</span>
          <Select
            ariaLabel="Minutes without data before a camera is flagged"
            value={String(draft.cameraWaitMinutes)}
            options={numberOptions(CAMERA_WAIT_MINUTE_OPTIONS)}
            onChange={(value) => set("cameraWaitMinutes", Number(value))}
            className="it-system__inline-select"
          />
          <span aria-hidden="true">minutes without data</span>
        </div>
      </SettingSection>

      <SettingSection title="Keep activity for" description="TANAW removes older activity automatically. Reports and visitor counts are never removed.">
        <SegmentedControl
          ariaLabel="Keep activity for"
          options={RETENTION_DAY_OPTIONS.map((days) => ({ value: String(days), label: retentionLabel(days) }))}
          value={String(draft.retentionDays)}
          onChange={(value) => set("retentionDays", Number(value))}
        />
        <p className="mt-3.5 text-sm text-(--tanaw-text-secondary)" role="status">
          {props.cleanupLoading ? "Checking the last cleanup." : cleanupText(props.cleanup, dateFormat, timeFormat)}
        </p>
        <Button type="button" variant="secondary" size="sm" className="mt-3" leadingIcon={<Trash2 size={15} aria-hidden="true" />} loading={props.isRemoving} onClick={() => setConfirm("remove")}>
          Remove older activity now
        </Button>
      </SettingSection>

      <SettingSection title="Date and time" description="How dates and times show for every account and on exported reports. Always Philippine time.">
        <div className="it-system__formats grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Select
            label="Date"
            value={draft.dateFormat}
            options={dateFormatOptions(now).map((option) => [option.value, option.label] as const)}
            onChange={(value) => set("dateFormat", value as SystemDateFormat)}
          />
          <Select
            label="Time"
            value={draft.timeFormat}
            options={timeFormatOptions(now).map((option) => [option.value, option.label] as const)}
            onChange={(value) => set("timeFormat", value as SystemTimeFormat)}
          />
        </div>
      </SettingSection>

      <p className="mt-6 text-[0.84375rem] text-(--tanaw-text-muted)">{lastChangedText(updatedAt, updatedBy, dateFormat)}</p>

      <SettingsSaveBar dirty={dirty} busy={isSaving} onDiscard={onDiscard} busyLabel="Saving settings...">
        Save settings
      </SettingsSaveBar>

      {confirm === "lockout" && (
        <ConfirmDialog
          title="Change the sign-in lockout?"
          icon={<ShieldCheck size={20} />}
          confirmLabel="Save settings"
          busy={isSaving}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onSave();
          }}
        >
          This applies to every account, including enterprises: an account will lock after {draft.loginAttemptLimit} wrong passwords, for {draft.loginLockMinutes} minutes.
        </ConfirmDialog>
      )}
      {confirm === "remove" && (
        <ConfirmDialog
          title="Remove older activity now?"
          tone="danger"
          confirmLabel="Remove older activity"
          busy={props.isRemoving}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            props.onRemoveOld();
          }}
        >
          Activity older than {retentionLabel(saved.retentionDays)} is removed for good. This cannot be undone. The removal is recorded in Activity.
          {saved.retentionDays !== draft.retentionDays && <> Save settings first to use {retentionLabel(draft.retentionDays)} instead.</>}
        </ConfirmDialog>
      )}
    </form>
  );
}

function SettingSection({ title, description, first = false, children }: { title: string; description: string; first?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-12 gap-y-4 border-b border-(--tanaw-border-soft) pb-7 max-lg:grid-cols-1 ${first ? "pt-2" : "pt-7"}`}
    >
      <div>
        <h2 id={id} className="text-[1.0625rem] font-[650] text-(--tanaw-text)">
          {title}
        </h2>
        <p className="mt-1 text-sm text-(--tanaw-text-secondary)">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
