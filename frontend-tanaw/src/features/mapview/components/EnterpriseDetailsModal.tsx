import { Activity, BarChart3, Building2, Camera, Clock, MapPin, Phone, Radio, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ModalFrame } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { GatewayStatus, OccupancyStatus } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { Badge, type BadgeTone } from "../../../design-system";

import { MonitoringStatusBadge } from "./MapDirectoryCards";

type EnterpriseDetailsModalProps = {
  enterprise: MapEnterprise;
  onClose: () => void;
  onOpenInsights: () => void;
};

export function EnterpriseDetailsModal({ enterprise, onClose, onOpenInsights }: EnterpriseDetailsModalProps) {
  const { timeFormat } = useSystemDisplayPreferences();

  return (
    <ModalFrame title={enterprise.name} eyebrow="Enterprise Details" onClose={onClose} maxWidthClassName="max-w-5xl">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]" data-details-modal-layout="balanced-enterprise">
        <section className="rounded-[22px] border border-emerald-100 bg-emerald-50/60 p-5 shadow-[0_14px_34px_rgba(6,95,70,0.08)] dark:border-emerald-300/20 dark:bg-emerald-500/10">
          <div className="flex items-start gap-3">
            <span className="text-tanaw-green flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-emerald-100 dark:bg-[#172033] dark:text-emerald-200 dark:ring-emerald-300/20">
              <Building2 size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">Enterprise Overview</p>
              </div>
              <p className="mt-1 text-sm leading-relaxed font-semibold text-(--tanaw-text-secondary)">
                {enterprise.category} - Barangay {enterprise.barangay}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <EnterpriseMetricCard icon={<Activity size={16} />} label="Total Live Occupancy" value={enterprise.totalLiveOccupancy?.toLocaleString() ?? "No live data"} />
            <EnterpriseMetricCard icon={<Users size={16} />} label="Estimated Unique Visitors" value={enterprise.estimatedUniqueCount?.toLocaleString() ?? "No live data"} />
            <EnterpriseMetricCard icon={<Radio size={16} />} label="Camera Monitoring" value={<MonitoringStatusBadge status={enterprise.monitoringStatus} />} />
            <EnterpriseMetricCard icon={<Activity size={16} />} label="Occupancy Alert" value={<OccupancyStatusBadge status={enterprise.occupancyStatus} />} />
          </div>
          <button
            type="button"
            onClick={onOpenInsights}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black text-white shadow-sm transition hover:bg-emerald-800"
          >
            <BarChart3 size={15} />
            View visitor insights
          </button>
        </section>

        <section className="grid auto-rows-fr gap-3 sm:grid-cols-2">
          <EnterpriseDetailRow icon={<Building2 size={15} />} label="Category" value={enterprise.category} />
          <EnterpriseDetailRow icon={<Radio size={15} />} label="Desktop App Status" value={<DesktopAppStatusBadge status={enterprise.gatewayStatus ?? "Not Linked"} />} />
          <EnterpriseDetailRow
            icon={<Camera size={15} />}
            label="Camera Coverage"
            value={
              enterprise.cameraMonitoring
                ? `${enterprise.cameraMonitoring.healthyCameraCount} of ${enterprise.cameraMonitoring.configuredCameraCount} cameras actively counting`
                : "No camera telemetry received"
            }
          />
          <EnterpriseDetailRow icon={<Clock size={15} />} label="Last update" value={enterprise.lastSync ? formatPhilippineDateTime(enterprise.lastSync, timeFormat) : "No update recorded"} />
          <EnterpriseDetailRow icon={<Phone size={15} />} label="Contact" value={enterprise.contact ?? "No contact listed"} />
          <EnterpriseDetailRow icon={<Clock size={15} />} label="Operating Hours" value={enterprise.operatingHours ?? "Not specified"} />
          <EnterpriseDetailRow className="sm:col-span-2" icon={<MapPin size={15} />} label="Full Address" value={enterprise.fullAddress} />
        </section>
      </div>
    </ModalFrame>
  );
}

function EnterpriseMetricCard({ icon, label, value, className = "" }: { icon: ReactNode; label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`rounded-tanaw-xl border border-white bg-white p-4 shadow-sm ring-1 ring-emerald-100/70 dark:border-slate-700 dark:bg-[#121c31] dark:ring-emerald-300/20 ${className}`}>
      <div className="text-tanaw-green flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-black tracking-[0.16em] text-slate-500 uppercase">{label}</p>
      </div>
      <div className="mt-2 text-lg leading-tight font-black text-(--tanaw-text) max-sm:text-base">{value}</div>
    </div>
  );
}

function EnterpriseDetailRow({ icon, label, value, className = "" }: { icon: ReactNode; label: string; value: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-tanaw-xl flex min-w-0 items-start gap-3 border border-slate-200 bg-slate-50/80 p-4 shadow-[0_8px_22px_rgba(15,23,42,0.05)] ring-1 ring-white dark:border-slate-700 dark:bg-[#0f172a] dark:ring-white/8 ${className}`}
    >
      <span className="text-tanaw-green mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-black tracking-[0.16em] text-slate-500 uppercase">{label}</p>
        <p className="mt-1 text-sm leading-relaxed font-bold wrap-break-word text-(--tanaw-text)">{value}</p>
      </div>
    </div>
  );
}

const occupancyTones: Record<OccupancyStatus, BadgeTone> = { Normal: "info", Warning: "warning", "High Occupancy": "danger", "No Data": "neutral" };
const gatewayTones: Record<GatewayStatus, BadgeTone> = { Connected: "success", "Sync Delayed": "warning", Offline: "neutral", "Not Linked": "neutral", Closed: "neutral" };
const gatewayLabels: Record<GatewayStatus, string> = {
  Connected: "Online",
  "Sync Delayed": "Updates Delayed",
  Offline: "Offline",
  "Not Linked": "No Desktop App Linked",
  Closed: "Closed",
};

function OccupancyStatusBadge({ status }: { status: OccupancyStatus }) {
  return <Badge tone={occupancyTones[status]}>{status}</Badge>;
}

function DesktopAppStatusBadge({ status }: { status: GatewayStatus }) {
  return <Badge tone={gatewayTones[status]}>{gatewayLabels[status]}</Badge>;
}
