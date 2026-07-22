import { type FormEvent, useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, MapPin, Maximize2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import type { BarangayPointResolution } from "@/features/mapview/utils";
import { ContactNumberField, FormField, ModalFrame, ModalPortal, SearchableDropdownField, type DropdownOption } from "@/shared/components/ui";
import { enterpriseCategories, sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import { type CreateEnterpriseAccountPayload, createEnterpriseAccount } from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import {
  PERSON_NAME_MAX_LENGTH,
  formatPersonName,
  normalizeEmail,
  normalizeMiddleInitial,
  normalizePhilippineContactNumber,
  validateEmail,
  validateMiddleInitial,
  validatePersonName,
  validatePhilippineContactNumber,
} from "@/shared/utils/accountValidation";
import type { LocationDraft } from "../types";
import { getLocationSummary } from "../utils";
import { LocationPicker } from "./LocationPicker";

type RegisterEnterpriseModalProps = {
  onClose: () => void;
};

type EnterpriseFormState = {
  enterpriseName: string;
  category: string;
  managerFirstName: string;
  managerMiddleInitial: string;
  managerLastName: string;
  email: string;
  contactLocal: string;
  enterpriseId: string;
  address: string;
  barangay: string;
  buildingCapacity: string;
};

type EnterpriseFormErrors = Partial<Record<keyof EnterpriseFormState, string>>;

const enterpriseCategoryValues = new Set<string>(enterpriseCategories.map((category) => category.value));
const sanPedroBarangayValues = new Set<string>(sanPedroBarangays);

export function RegisterEnterpriseModal({ onClose }: RegisterEnterpriseModalProps) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useState<LocationDraft | null>(null);
  const [detectedBarangay, setDetectedBarangay] = useState<string | null>(null);
  const [isFullMapOpen, setIsFullMapOpen] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [form, setForm] = useState<EnterpriseFormState>({
    enterpriseName: "",
    category: "",
    managerFirstName: "",
    managerMiddleInitial: "",
    managerLastName: "",
    email: "",
    contactLocal: "",
    enterpriseId: "",
    address: "",
    barangay: "",
    buildingCapacity: "100",
  });
  const [errors, setErrors] = useState<EnterpriseFormErrors>({});
  const [locationError, setLocationError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createEnterpriseAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }),
        queryClient.invalidateQueries({ queryKey: ["email-deliveries"] }),
      ]);
      toast.success("Enterprise account created; activation email queued");
      onClose();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to create enterprise account")),
  });
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEnterpriseForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!location) {
      const message = "Choose a map location inside San Pedro before saving.";
      setLocationError(message);
      toast.error(message);
      return;
    }
    if (locationError) {
      toast.error(locationError);
      return;
    }

    const normalizedPhone = form.contactLocal ? normalizePhilippineContactNumber(`+63${form.contactLocal}`) : "";
    const payload: CreateEnterpriseAccountPayload = {
      enterpriseName: form.enterpriseName.trim(),
      category: form.category,
      managerName: formatPersonName({ firstName: form.managerFirstName, middleInitial: form.managerMiddleInitial, lastName: form.managerLastName }),
      email: normalizeEmail(form.email),
      contactNumber: normalizedPhone || undefined,
      barangay: form.barangay,
      address: form.address.trim(),
      enterpriseId: form.enterpriseId.trim() || undefined,
      buildingCapacity: Number(form.buildingCapacity),
      latitude: location.latitude,
      longitude: location.longitude,
    };
    createMutation.mutate(payload);
  };

  return (
    <>
      <ModalFrame title="Register Enterprise" onClose={isFullMapOpen ? () => setIsFullMapOpen(false) : onClose} maxWidthClassName="max-w-5xl">
        <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <FormField name="enterpriseName" label="Enterprise Name" value={form.enterpriseName} onChange={(value) => updateField("enterpriseName", value)} error={errors.enterpriseName} required />
          <SearchableDropdownField
            name="category"
            label="Enterprise Type / Category"
            options={enterpriseCategories.map((category): DropdownOption => [category.value, category.label])}
            value={form.category}
            onChange={(value) => updateField("category", value)}
            error={errors.category}
            required
          />
          <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
            <FormField
              name="managerFirstName"
              label="Contact First Name"
              value={form.managerFirstName}
              onChange={(value) => updateField("managerFirstName", value)}
              error={errors.managerFirstName}
              required
              autoComplete="given-name"
              maxLength={PERSON_NAME_MAX_LENGTH}
            />
            <FormField
              name="managerMiddleInitial"
              label="Middle Initial"
              value={form.managerMiddleInitial}
              onChange={(value) => updateField("managerMiddleInitial", normalizeMiddleInitial(value))}
              error={errors.managerMiddleInitial}
              autoComplete="additional-name"
              maxLength={1}
              helperText="Optional"
            />
            <FormField
              name="managerLastName"
              label="Contact Last Name"
              value={form.managerLastName}
              onChange={(value) => updateField("managerLastName", value)}
              error={errors.managerLastName}
              required
              autoComplete="family-name"
              maxLength={PERSON_NAME_MAX_LENGTH}
            />
          </div>
          <FormField name="email" label="Contact Email" type="email" value={form.email} onChange={(value) => updateField("email", value)} error={errors.email} required autoComplete="email" />
          <ContactNumberField name="contactNumber" label="Contact Number (Optional)" value={form.contactLocal} onChange={(value) => updateField("contactLocal", value)} error={errors.contactLocal} />
          <FormField
            name="enterpriseId"
            label="Enterprise ID Seed"
            placeholder="Leave blank to use enterprise name"
            value={form.enterpriseId}
            onChange={(value) => updateField("enterpriseId", value)}
          />
          <FormField
            name="buildingCapacity"
            label="Building Capacity"
            type="number"
            value={form.buildingCapacity}
            onChange={(value) => updateField("buildingCapacity", value)}
            error={errors.buildingCapacity}
            required
          />
          <FormField name="address" label="Block / Lot / Street" value={form.address} onChange={(value) => updateField("address", value)} error={errors.address} required />
          <SearchableDropdownField
            name="barangay"
            label="Barangay"
            options={sanPedroBarangays.map((item): DropdownOption => [item, item])}
            value={form.barangay}
            onChange={(value) => updateField("barangay", value)}
            error={errors.barangay}
            required
          />

          <div className="rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.68)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.7)_100%)] p-4 shadow-sm ring-1 ring-white md:col-span-2 dark:border-emerald-300/20 dark:bg-[linear-gradient(135deg,#0f2d3c_0%,#172033_54%,#312638_100%)] dark:ring-white/8">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">Map Location</p>
                <p className="mt-1 text-sm text-slate-500">{location ? getLocationSummary(location) : "No marker confirmed yet. Click inside San Pedro to place it manually."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <BoundaryToggleButton showBoundaries={showBoundaries} onClick={() => setShowBoundaries((current) => !current)} />
                <button
                  type="button"
                  onClick={() => setIsFullMapOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#121c31] dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                >
                  <Maximize2 size={15} />
                  Full Map View
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <LocationPicker
                location={location}
                mapId="enterprise-location-picker"
                mapHeightClassName="h-80"
                showBoundaries={showBoundaries}
                resizeSignal={showBoundaries ? "boundaries-on" : "boundaries-off"}
                onBoundaryDetection={applyBoundaryDetection}
                onChange={applySelectedLocation}
                onReject={handleLocationRejected}
              />
              <LocationStatusPanel
                address={form.address}
                barangay={form.barangay}
                detectedBarangay={detectedBarangay}
                location={location}
                locationError={locationError}
                locationNotice={locationNotice}
              />
            </div>

            {locationError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{locationError}</span>
              </div>
            )}
          </div>

          <div className="tanaw-information-banner flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/80 p-4 ring-1 ring-white md:col-span-2 dark:ring-white/5">
            <CheckCircle2 className="tanaw-information-banner__icon mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-emerald-800 dark:text-emerald-100">
              TANAW will queue a secure activation link for the registered contact email. The enterprise user will choose a private password before signing in to the TANAW Enterprise desktop
              application.
            </p>
          </div>

          <button
            disabled={createMutation.isPending}
            className="bg-tanaw-green rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(5,91,37,0.22)] transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70 md:col-span-2"
          >
            {createMutation.isPending ? "Registering..." : "Register Enterprise"}
          </button>
        </form>
      </ModalFrame>

      <AnimatePresence>
        {isFullMapOpen && (
          <FullMapView
            address={form.address}
            barangay={form.barangay}
            detectedBarangay={detectedBarangay}
            location={location}
            locationError={locationError}
            locationNotice={locationNotice}
            showBoundaries={showBoundaries}
            onBoundaryDetection={applyBoundaryDetection}
            onChange={applySelectedLocation}
            onClose={() => setIsFullMapOpen(false)}
            onReject={handleLocationRejected}
            onToggleBoundaries={() => setShowBoundaries((current) => !current)}
          />
        )}
      </AnimatePresence>
    </>
  );

  function updateField<FieldName extends keyof EnterpriseFormState>(field: FieldName, value: EnterpriseFormState[FieldName]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function applySelectedLocation(nextLocation: LocationDraft, barangayDetection?: BarangayPointResolution) {
    const barangayName = barangayDetection?.barangayName ?? null;
    setLocation(nextLocation);
    setDetectedBarangay(barangayName);
    setLocationError(null);
    setLocationNotice(getPolygonLocationNotice(barangayDetection));
    if (barangayName && sanPedroBarangayValues.has(barangayName)) {
      setForm((current) => ({ ...current, barangay: barangayName }));
    }
  }

  function applyBoundaryDetection(selectedLocation: LocationDraft, barangayDetection: BarangayPointResolution) {
    if (!location || !locationsMatch(location, selectedLocation)) return;

    const barangayName = barangayDetection.barangayName;
    setDetectedBarangay(barangayName);
    setLocationError(null);
    setLocationNotice(getPolygonLocationNotice(barangayDetection));
    if (barangayName && sanPedroBarangayValues.has(barangayName)) {
      setForm((current) => ({ ...current, barangay: barangayName }));
    }
  }

  function handleLocationRejected(message: string) {
    setLocationError(message);
    toast.error(message);
  }
}

type FullMapViewProps = {
  address: string;
  barangay: string;
  detectedBarangay: string | null;
  location: LocationDraft | null;
  locationError: string | null;
  locationNotice: string | null;
  showBoundaries: boolean;
  onBoundaryDetection: (location: LocationDraft, barangayDetection: BarangayPointResolution) => void;
  onChange: (location: LocationDraft, barangayDetection?: BarangayPointResolution) => void;
  onClose: () => void;
  onReject: (message: string) => void;
  onToggleBoundaries: () => void;
};

function FullMapView({
  address,
  barangay,
  detectedBarangay,
  location,
  locationError,
  locationNotice,
  showBoundaries,
  onBoundaryDetection,
  onChange,
  onClose,
  onReject,
  onToggleBoundaries,
}: FullMapViewProps) {
  return (
    <ModalPortal>
      <motion.div
        className="fixed inset-0 z-1500 flex min-h-dvh items-center justify-center bg-[rgba(3,20,12,0.72)] p-4 backdrop-blur-[7px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerDown={onClose}
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Full map view"
          className="relative z-1501 flex max-h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.42)] ring-1 ring-black/5 dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_34px_100px_rgba(0,0,0,0.55)] dark:ring-white/8"
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.985 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="from-tanaw-green to-tanaw-lime h-1.5 bg-linear-to-r via-[#d9b44a]" />
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] px-5 py-4 dark:border-slate-600 dark:bg-[linear-gradient(135deg,#0f2d3c_0%,#172033_54%,#312638_100%)]">
            <div className="min-w-0">
              <p className="text-[10px] font-black tracking-[0.18em] text-emerald-700/80 uppercase">Map Location</p>
              <h3 className="text-tanaw-navy mt-1 text-xl leading-tight font-bold">Full Map View</h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">Click inside San Pedro or drag the marker to refine the exact enterprise location.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <BoundaryToggleButton showBoundaries={showBoundaries} onClick={onToggleBoundaries} />
              <button
                type="button"
                onClick={onClose}
                className="hover:text-tanaw-green focus:ring-tanaw-green/15 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 focus:ring-4 focus:outline-none dark:border-emerald-300/20 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-[#1d2940] dark:hover:text-emerald-200"
                aria-label="Close full map view"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <LocationPicker
              location={location}
              mapId="enterprise-location-picker-full"
              mapHeightClassName="h-[min(66dvh,680px)] min-h-105"
              resizeSignal={showBoundaries ? "full-boundaries-on" : "full-boundaries-off"}
              showBoundaries={showBoundaries}
              onBoundaryDetection={onBoundaryDetection}
              onChange={onChange}
              onReject={onReject}
            />
            <div className="flex min-h-0 flex-col gap-3">
              <LocationStatusPanel address={address} barangay={barangay} detectedBarangay={detectedBarangay} location={location} locationError={locationError} locationNotice={locationNotice} />
              <button
                type="button"
                onClick={onClose}
                className="bg-tanaw-green mt-auto inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#044a1e]"
              >
                <CheckCircle2 size={16} />
                Use Selected Location
              </button>
            </div>
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}

type LocationStatusPanelProps = {
  address: string;
  barangay: string;
  detectedBarangay: string | null;
  location: LocationDraft | null;
  locationError: string | null;
  locationNotice: string | null;
};

function LocationStatusPanel({ address, barangay, detectedBarangay, location, locationError, locationNotice }: LocationStatusPanelProps) {
  return (
    <aside className="rounded-2xl border border-emerald-100 bg-white/86 p-4 text-sm shadow-sm ring-1 ring-white dark:border-emerald-300/20 dark:bg-[#121c31]/92 dark:ring-white/8">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          {locationError ? <AlertTriangle size={17} /> : location ? <CheckCircle2 size={17} /> : <MapPin size={17} />}
        </span>
        <div>
          <p className="text-[10px] font-black tracking-[0.18em] text-slate-500 uppercase">Location Status</p>
          <p className={`text-sm font-bold ${locationError ? "text-amber-700" : location ? "text-emerald-700" : "text-slate-700"}`}>
            {locationError ? "Needs review" : location ? "Inside San Pedro" : "Marker not set"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <SummaryRow label="Detected Barangay" value={detectedBarangay || "Not detected yet"} />
        <SummaryRow label="Selected Barangay" value={barangay || "Not detected yet"} />
        <SummaryRow label="Block / Lot / Street" value={address || "Enter the address manually above"} />
        <SummaryRow label="Coordinates" value={location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "No coordinates yet"} />
      </div>

      {(locationNotice || locationError) && (
        <div
          className={`mt-4 rounded-xl border px-3 py-2 text-xs font-semibold ${locationError ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}
        >
          {locationError ?? locationNotice}
        </div>
      )}
    </aside>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-[#0f172a]">
      <p className="text-[10px] font-black tracking-[0.15em] text-slate-500 uppercase">{label}</p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold wrap-break-word text-slate-800">{value}</p>
    </div>
  );
}

function BoundaryToggleButton({ showBoundaries, onClick }: { showBoundaries: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={showBoundaries}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#121c31] dark:text-emerald-200 dark:hover:bg-emerald-500/10"
    >
      <Layers size={15} />
      {showBoundaries ? "Hide Boundaries" : "Show Boundaries"}
    </button>
  );
}

function locationsMatch(left: LocationDraft, right: LocationDraft) {
  return Math.abs(left.latitude - right.latitude) < 0.000001 && Math.abs(left.longitude - right.longitude) < 0.000001;
}

function getPolygonLocationNotice(barangayDetection: BarangayPointResolution | undefined) {
  if (!barangayDetection) return "Marker placed inside San Pedro. Drag it to adjust the exact location.";
  if (!barangayDetection.barangayName) return "Marker placed inside San Pedro city bounds. Barangay boundary data is unavailable.";
  if (barangayDetection.isAmbiguous) {
    return `Multiple barangay boundaries matched this marker; using ${barangayDetection.barangayName} by polygon priority.`;
  }
  return `Barangay polygon detected: ${barangayDetection.barangayName}.`;
}

function validateEnterpriseForm(form: EnterpriseFormState) {
  const errors: EnterpriseFormErrors = {};
  const enterpriseName = form.enterpriseName.trim();
  const emailError = validateEmail(form.email);
  const managerFirstNameError = validatePersonName(form.managerFirstName, "First name");
  const managerMiddleInitialError = validateMiddleInitial(form.managerMiddleInitial);
  const managerLastNameError = validatePersonName(form.managerLastName, "Last name");
  const phoneError = validatePhilippineContactNumber(form.contactLocal ? `+63${form.contactLocal}` : "", false);

  if (!enterpriseName) errors.enterpriseName = "Enterprise name is required.";
  if (enterpriseName && enterpriseName.length < 2) errors.enterpriseName = "Enterprise name must be at least 2 characters.";
  if (!enterpriseCategoryValues.has(form.category)) errors.category = "Choose a valid enterprise type.";
  if (managerFirstNameError) errors.managerFirstName = managerFirstNameError;
  if (managerMiddleInitialError) errors.managerMiddleInitial = managerMiddleInitialError;
  if (managerLastNameError) errors.managerLastName = managerLastNameError;
  if (emailError) errors.email = emailError;
  if (phoneError) errors.contactLocal = phoneError;
  if (!form.address.trim()) errors.address = "Address is required.";
  if (!sanPedroBarangayValues.has(form.barangay)) errors.barangay = "Choose a valid barangay.";
  const capacityError = validateBuildingCapacity(form.buildingCapacity);
  if (capacityError) errors.buildingCapacity = capacityError;

  return errors;
}

function validateBuildingCapacity(value: string) {
  const capacity = Number(value);
  if (!value.trim()) return "Building capacity is required.";
  if (!Number.isInteger(capacity)) return "Building capacity must be a whole number.";
  if (capacity < 1) return "Building capacity must be at least 1.";
  if (capacity > 100000) return "Building capacity cannot exceed 100,000.";
  return null;
}
