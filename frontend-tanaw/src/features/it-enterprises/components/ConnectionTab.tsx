import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Inbox } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { enterpriseHealthTodayQueryKey, getEnterpriseHealthToday, type CameraDayStrip, type CameraHealth } from "@/shared/services/enterpriseHealth";
import { notifyEnterprise } from "@/shared/services/reporting";
import { listEnterpriseRequests, requestsQueryKey } from "@/shared/services/requests";
import { Alert, Button, EmptyState, Input, Skeleton, Textarea, cn } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { notifyError, notifySuccess } from "../hooks/useEnterpriseActions";
import { STRIP_LEGEND, appVersion, cameraKind, cameraState, lastDataText, requestStatus, requestWhen, stripIntro, stripSummary, stripTicks } from "../model/connection";
import { appCell, type DisplayFormats, type EnterpriseRow } from "../model/enterprises";
import { requestPath } from "../model/paths";
import { FieldError, FieldLabel, SectionHeading, StateText } from "./StateText";
import { toneText } from "./tones";

const TODAY_REFRESH_MS = 60_000;
const REQUESTS_SHOWN = 5;

/** Connection: the desktop app's facts, today's camera strip, requests from the place and a notice. */
export function ConnectionTab({ row, formats }: { row: EnterpriseRow; formats: DisplayFormats }) {
  return (
    <div>
      <AppFacts row={row} formats={formats} />
      <CamerasToday row={row} formats={formats} />
      <div className="mt-8 grid grid-cols-2 gap-x-12 gap-y-8 max-lg:grid-cols-1">
        <RequestsFromPlace row={row} formats={formats} />
        <NoticeForm row={row} />
      </div>
    </div>
  );
}

function AppFacts({ row, formats }: { row: EnterpriseRow; formats: DisplayFormats }) {
  const app = row.health?.app;
  const status = appCell(row, formats);
  const version = app ? appVersion(app) : { version: "Not reported", note: null };
  const cell = "min-w-0 px-5 py-4 first:pl-0 max-lg:px-0 max-lg:py-3";
  const term = "text-[13px] text-(--tanaw-text-muted)";
  const value = "mt-1 font-semibold text-(--tanaw-text)";
  return (
    <dl className="grid grid-cols-4 border-y border-(--tanaw-border-soft) max-lg:grid-cols-2 max-sm:grid-cols-1 lg:[&>div+div]:border-l lg:[&>div+div]:border-(--tanaw-border-soft)">
      <div className={cell}>
        <dt className={term}>Desktop app status</dt>
        <dd className="mt-1">
          <StateText tone={status.tone} dot className="font-semibold">
            {status.label}
          </StateText>
          {status.label === "Closed" && status.sub && <span className="mt-0.5 block text-[13px] text-(--tanaw-text-muted)">{status.sub}</span>}
        </dd>
      </div>
      <div className={cell}>
        <dt className={term}>Last data received</dt>
        <dd className={value}>{lastDataText(app?.lastDataAt, formats.now, formats.dateFormat, formats.timeFormat)}</dd>
      </div>
      <div className={cell}>
        <dt className={term}>App version</dt>
        <dd className={value}>
          {version.version} {version.note && <span className={cn("font-medium", version.note === "(latest)" ? "text-(--tanaw-text-muted)" : "text-(--tanaw-warn-ink)")}>{version.note}</span>}
        </dd>
      </div>
      <div className={cell}>
        <dt className={term}>Signed in on computer</dt>
        <dd className={cn(value, "wrap-break-word")}>{app?.computerName || "Not reported"}</dd>
      </div>
    </dl>
  );
}

function CamerasToday({ row, formats }: { row: EnterpriseRow; formats: DisplayFormats }) {
  const today = useQuery({
    queryKey: enterpriseHealthTodayQueryKey(row.enterpriseId),
    queryFn: () => getEnterpriseHealthToday(row.enterpriseId),
    refetchInterval: TODAY_REFRESH_MS,
  });
  const liveCameras = new Map((row.health?.cameras.list ?? []).map((camera) => [camera.id, camera]));

  return (
    <section aria-labelledby="ite-cameras-today" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <SectionHeading id="ite-cameras-today">Cameras today</SectionHeading>
          <p className="mt-1 text-[13px] text-(--tanaw-text-secondary)">{today.data ? stripIntro(today.data, formats.timeFormat) : "Each block is one hour of today."}</p>
        </div>
        <ul aria-label="Legend" className="flex flex-wrap gap-x-3.5 gap-y-1.5">
          {STRIP_LEGEND.map((item) => (
            <li key={item.state} className="inline-flex items-center gap-1.5 text-[13px] text-(--tanaw-text-secondary)">
              <span aria-hidden="true" data-state={item.state} className="ite-slot h-3! w-3 rounded-[3px]!" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-2 border-t border-(--tanaw-border-soft)">
        {today.isLoading ? (
          <div role="status" aria-label="Loading cameras">
            {[0, 1].map((index) => (
              <div key={index} className="grid grid-cols-[minmax(12rem,1fr)_minmax(0,2.2fr)] items-center gap-x-7 gap-y-2.5 border-b border-(--tanaw-border-soft) py-4 max-lg:grid-cols-1">
                <div>
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-24" />
                </div>
                <div>
                  <Skeleton className="h-5.5 w-full" />
                  <Skeleton className="mt-2.5 h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : today.isError ? (
          <Alert
            tone="warning"
            className="mt-4"
            title="Today's camera record could not be loaded"
            action={
              <Button size="sm" variant="secondary" onClick={() => void today.refetch()}>
                Try again
              </Button>
            }
          />
        ) : !today.data || today.data.cameras.length === 0 ? (
          <EmptyState icon={<Camera size={22} />} title="No cameras yet" description="Cameras appear here once the enterprise adds them in the desktop app." minHeightClassName="min-h-40" />
        ) : (
          today.data.cameras.map((camera) => <CameraRow key={camera.id} camera={camera} live={liveCameras.get(camera.id)} hours={today.data.hours} formats={formats} />)
        )}
      </div>
    </section>
  );
}

function CameraRow({ camera, live, hours, formats }: { camera: CameraDayStrip; live: CameraHealth | undefined; hours: number[]; formats: DisplayFormats }) {
  const kind = cameraKind(camera);
  const state = cameraState(live, formats.now, formats.dateFormat, formats.timeFormat);
  const slots = new Map(camera.slots.map((slot) => [slot.hour, slot.state]));
  const ticks = stripTicks(hours, formats.timeFormat);
  return (
    <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(0,2.2fr)] items-center gap-x-7 gap-y-2.5 border-b border-(--tanaw-border-soft) py-4 max-lg:grid-cols-1">
      <div className="min-w-0">
        <p className="font-semibold text-(--tanaw-text)">{camera.name}</p>
        {kind && <p className="mt-0.5 text-[13px] text-(--tanaw-text-secondary)">{kind}</p>}
        <StateText tone={state.tone} dot className="mt-1.5 text-sm">
          {state.text}
        </StateText>
      </div>
      <div className="min-w-0">
        <div role="img" aria-label={stripSummary(camera, formats.timeFormat)} className="grid gap-0.75" style={{ gridTemplateColumns: `repeat(${Math.max(hours.length, 1)}, minmax(0, 1fr))` }}>
          {hours.map((hour) => (
            <span key={hour} data-state={slots.get(hour) ?? "future"} className="ite-slot" />
          ))}
        </div>
        <div aria-hidden="true" className="relative mt-1 h-4 text-xs text-(--tanaw-text-muted)">
          {ticks.map((tick, index) => (
            <span
              key={tick.hour}
              className="absolute top-0 whitespace-nowrap"
              style={index === 0 ? { left: 0 } : index === ticks.length - 1 ? { right: 0 } : { left: `${tick.percent}%`, transform: "translateX(-50%)" }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-(--tanaw-text-secondary)">{camera.note}</p>
      </div>
    </div>
  );
}

function RequestsFromPlace({ row, formats }: { row: EnterpriseRow; formats: DisplayFormats }) {
  const requests = useQuery({
    queryKey: [...requestsQueryKey, "enterprise", row.enterpriseId],
    queryFn: () => listEnterpriseRequests(row.enterpriseId),
  });
  const items = (requests.data ?? []).slice(0, REQUESTS_SHOWN);
  return (
    <section aria-labelledby="ite-requests">
      <SectionHeading id="ite-requests">Requests from this place</SectionHeading>
      {requests.isLoading ? (
        <div role="status" aria-label="Loading requests" className="mt-2.5 border-t border-(--tanaw-border-soft)">
          {[0, 1].map((index) => (
            <div key={index} className="border-b border-(--tanaw-border-soft) py-3.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-2.5 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : requests.isError ? (
        <p className="mt-3 text-sm text-(--tanaw-warn-ink)">Requests could not be loaded.</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<Inbox size={22} />} title="No requests from this place" description="Requests the enterprise sends from the desktop app show here." minHeightClassName="min-h-40" />
      ) : (
        <ul className="mt-2.5 border-t border-(--tanaw-border-soft)">
          {items.map((request) => {
            const status = requestStatus(request);
            return (
              <li key={request.id} className="border-b border-(--tanaw-border-soft) py-3.5">
                <span className="flex justify-between gap-3 text-[13px] text-(--tanaw-text-secondary)">
                  <span>
                    {request.group} · {requestWhen(request.createdAt, formats.now, formats.dateFormat, formats.timeFormat)}
                  </span>
                  <span className="text-(--tanaw-text-muted) tabular-nums">{request.code}</span>
                </span>
                <Link to={requestPath(request.id)} className="mt-1 block font-semibold text-(--tanaw-accent-ink) no-underline underline-offset-4 hover:underline">
                  {request.title}
                </Link>
                <span className={cn("mt-0.5 block text-sm font-semibold", toneText[status.tone])}>{status.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {(requests.data?.length ?? 0) > REQUESTS_SHOWN && (
        <p className="mt-2 text-[13px] text-(--tanaw-text-muted)">
          Showing the newest {REQUESTS_SHOWN} of {requests.data?.length.toLocaleString("en-US")} requests.
        </p>
      )}
    </section>
  );
}

function NoticeForm({ row }: { row: EnterpriseRow }) {
  const titleId = useId();
  const messageId = useId();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ title?: string; message?: string }>({});
  const send = useMutation({
    mutationFn: () => notifyEnterprise({ enterpriseId: row.enterpriseId, title: title.trim(), message: message.trim() }),
    onSuccess: () => {
      setTitle("");
      setMessage("");
      notifySuccess("Notice sent", `It shows in ${row.name}'s desktop app now.`);
    },
    onError: (error) => notifyError("Notice not sent", getApiErrorMessage(error, "The notice could not be sent. Try again.")),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { title: title.trim() ? undefined : "Add a short title.", message: message.trim() ? undefined : "Write the message." };
    setErrors(next);
    if (next.title) document.getElementById(titleId)?.focus();
    else if (next.message) document.getElementById(messageId)?.focus();
    else send.mutate();
  };

  if (row.accountState !== "active") {
    return (
      <section aria-labelledby="ite-notice">
        <SectionHeading id="ite-notice">Send a notice</SectionHeading>
        <p className="mt-1 text-sm text-(--tanaw-text-secondary)">
          {row.accountState === "deactivated" ? "Activate the enterprise to send it notices." : "Notices reach the desktop app once the owner signs in."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="ite-notice">
      <SectionHeading id="ite-notice">Send a notice</SectionHeading>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">It shows in the desktop app's notifications. Use it for quick fixes they can do on site.</p>
      <form noValidate onSubmit={submit} className="mt-3 grid gap-3">
        <div>
          <FieldLabel htmlFor={titleId}>Title</FieldLabel>
          <Input
            id={titleId}
            value={title}
            maxLength={160}
            placeholder="For example: Check the Gate A camera cable"
            invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? `${titleId}-error` : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
          />
          <FieldError id={`${titleId}-error`}>{errors.title}</FieldError>
        </div>
        <div>
          <FieldLabel htmlFor={messageId}>Message</FieldLabel>
          <Textarea
            id={messageId}
            value={message}
            maxLength={2000}
            rows={4}
            invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? `${messageId}-error` : undefined}
            onChange={(event) => {
              setMessage(event.target.value);
              setErrors((current) => ({ ...current, message: undefined }));
            }}
          />
          <FieldError id={`${messageId}-error`}>{errors.message}</FieldError>
        </div>
        <div>
          <Button type="submit" loading={send.isPending}>
            Send to {row.name}
          </Button>
        </div>
      </form>
    </section>
  );
}
