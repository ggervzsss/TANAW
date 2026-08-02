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
        <div className="mt-5 rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-amber-50 p-4">
          <p className="text-sm font-semibold text-slate-700">This activity is connected to an enterprise support request. Open it to review the full request, attachments, status, and response.</p>
          <button
            type="button"
            onClick={openTicket}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800"
          >
            <TicketCheck size={14} /> Open Support Request
          </button>
        </div>
      )}
    </ModalFrame>
  );
}
