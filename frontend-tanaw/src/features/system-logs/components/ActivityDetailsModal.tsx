import { TicketCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { ModalFrame } from "@/shared/components/ui";
import type { SystemLog } from "@/shared/types";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { activityGroupFor, supportTicketIdFromActivity } from "../model";
import { ActivityDetailFields } from "./ActivityDetailFields";

export function ActivityDetailsModal({ activity, role, timeFormat, onClose }: { activity: SystemLog; role: "admin" | "it"; timeFormat: SystemTimeFormat; onClose: () => void }) {
  const navigate = useNavigate();
  const ticketId = supportTicketIdFromActivity(activity);
  const openTicket = () => {
    if (!ticketId) return;
    onClose();
    navigate(role === "admin" ? `${routes.admin.operations}?view=support&ticket=${encodeURIComponent(ticketId)}` : `${routes.it.workCenter}?view=support&ticket=${encodeURIComponent(ticketId)}`);
  };
  return (
    <ModalFrame title="Activity Details" eyebrow={role === "admin" ? activityGroupFor(activity) : activity.id} onClose={onClose} maxWidthClassName={role === "admin" ? "max-w-4xl" : undefined}>
      <ActivityDetailFields activity={activity} timeFormat={timeFormat} variant={role} />
      {ticketId && (
        <div className="mt-5 rounded-2xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) p-4">
          <p className="text-sm font-semibold text-(--tanaw-text-secondary)">This activity is connected to an enterprise support request. Open it to review the full request, attachments, status, and response.</p>
          <button
            type="button"
            onClick={openTicket}
            className="mt-3 inline-flex min-h-10.5 items-center justify-center gap-2 rounded-xl bg-tanaw-civic px-4 text-sm font-bold text-white shadow-sm transition hover:bg-tanaw-civic-deep"
          >
            <TicketCheck size={14} /> Open Support Request
          </button>
        </div>
      )}
    </ModalFrame>
  );
}
