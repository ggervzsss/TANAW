import { type FormEvent, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, LocateFixed, MapPin, Maximize2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { BarangayPointResolution } from "@/features/mapview/utils";
import { ContactNumberField, FormField, ModalFrame, ModalPortal, SearchableDropdownField, type DropdownOption } from "@/shared/components/ui";
import { enterpriseCategories, sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import { type CreateEnterpriseAccountPayload, createEnterpriseAccount, geocodeEnterpriseAddress, reverseGeocodeEnterpriseLocation } from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { normalizeEmail, normalizePersonName, normalizePhilippineContactNumber, validateEmail, validatePersonName, validatePhilippineContactNumber } from "@/shared/utils/accountValidation";
import type { LocationDraft } from "../types";
import { getLocationSummary } from "../utils";
import { LocationPicker } from "./LocationPicker";

type RegisterEnterpriseModalProps = {
  onClose: () => void;
};

type EnterpriseFormState = {
  enterpriseName: string;
  category: string;
  managerName: string;
  email: string;
  contactLocal: string;
  enterpriseId: string;
  address: string;
  barangay: string;
};

type EnterpriseFormErrors = Partial<Record<keyof EnterpriseFormState, string>>;

const enterpriseCategoryValues = new Set<string>(enterpriseCategories.map((category) => category.value));
const sanPedroBarangayValues = new Set<string>(sanPedroBarangays);

type ReverseGeocodeContext = {
  detectedBarangay: string | null;
  location: LocationDraft;
};

export function RegisterEnterpriseModal({ onClose }: RegisterEnterpriseModalProps) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement | null>(null);
  const formStateRef = useRef<EnterpriseFormState | null>(null);
  const locationStateRef = useRef<LocationDraft | null>(null);
  const detectedBarangayRef = useRef<string | null>(null);
  const addressWasEditedRef = useRef(false);
  const lastAutoAddressRef = useRef("");
  const [location, setLocation] = useState<LocationDraft | null>(null);
  const [detectedBarangay, setDetectedBarangay] = useState<string | null>(null);
  const [isFullMapOpen, setIsFullMapOpen] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [form, setForm] = useState<EnterpriseFormState>({
    enterpriseName: "",
    category: "",
    managerName: "",
    email: "",
    contactLocal: "",
    enterpriseId: "",
    address: "",
    barangay: "",
  });
  const [errors, setErrors] = useState<EnterpriseFormErrors>({});
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    formStateRef.current = form;
  }, [form]);

  useEffect(() => {
    locationStateRef.current = location;
  }, [location]);

  useEffect(() => {
    detectedBarangayRef.current = detectedBarangay;
  }, [detectedBarangay]);

  const createMutation = useMutation({
    mutationFn: createEnterpriseAccount,
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] }), queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] })]);
      toast.success("Enterprise account created");
      onClose();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to create enterprise account")),
  });
  const geocodeMutation = useMutation({
    mutationFn: geocodeEnterpriseAddress,
    onSuccess: (result) => {
      setLocationNotice("Address lookup placed a marker. Review or drag the marker before saving.");
      applySelectedLocation({
        latitude: result.latitude,
        longitude: result.longitude,
        source: "geocoded",
        confidence: result.confidence,
        displayAddress: result.displayAddress,
        provider: result.provider,
      });
      toast.success("Location marker placed");
    },
    onError: () => {
      setLocationNotice("Unable to locate this address. Place the marker manually on the map.");
      toast.error("Unable to locate this address. Place the marker manually on the map.");
    },
  });

  const handleLocateAddress = () => {
    if (!formRef.current) return;

    const barangay = form.barangay;
    const address = form.address.trim();

    if (!barangay || !address) {
      toast.error("Enter the address and choose a barangay before locating.");
      return;
    }

    geocodeMutation.mutate({
      enterpriseName: form.enterpriseName.trim() || undefined,
      barangay,
      address,
    });
  };

  const reverseGeocodeMutation = useMutation({
    mutationFn: ({ location: selectedLocation }: ReverseGeocodeContext) => reverseGeocodeEnterpriseLocation({ latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }),
    onSuccess: (result, { detectedBarangay: polygonBarangay, location: selectedLocation }) => {
      const currentLocation = locationStateRef.current;
      if (!currentLocation || !locationsMatch(currentLocation, selectedLocation)) return;

      const effectivePolygonBarangay = polygonBarangay ?? detectedBarangayRef.current;
      const nextAddress = normalizeDetectedAddress(result.address, effectivePolygonBarangay);
      const latestAddress = formStateRef.current?.address ?? "";
      const canUseDetectedAddress = shouldUseDetectedAddress(latestAddress, nextAddress, lastAutoAddressRef.current, addressWasEditedRef.current);
      const geocoderBarangay = result.barangay && sanPedroBarangayValues.has(result.barangay) ? result.barangay : null;
      const barangayNotice = getReverseGeocoderBarangayNotice(effectivePolygonBarangay, geocoderBarangay);
      const barangayPrefix = effectivePolygonBarangay ? "Polygon barangay kept." : "Marker confirmed.";

      if (canUseDetectedAddress && nextAddress) {
        lastAutoAddressRef.current = nextAddress;
        addressWasEditedRef.current = false;
      }

      setLocation((current) => {
        if (!current || !locationsMatch(current, selectedLocation)) return current;
        return {
          ...current,
          confidence: result.confidence ?? current.confidence,
          displayAddress: result.displayAddress,
          provider: result.provider,
        };
      });

      setForm((current) => {
        return {
          ...current,
          address: canUseDetectedAddress && nextAddress ? nextAddress : current.address,
        };
      });

      if (canUseDetectedAddress && nextAddress) {
        setLocationNotice(`${barangayPrefix} Detected street address was applied.${barangayNotice}`);
        return;
      }

      setLocationNotice(nextAddress ? `${barangayPrefix} Detected address is available, but your typed street address was kept.${barangayNotice}` : `${barangayPrefix} Street-level address was not available from reverse geocoding.${barangayNotice}`);
    },
    onError: () => {
      setLocationNotice("Address lookup failed. Keep the marker if the coordinates are correct, or adjust it manually.");
    },
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
      managerName: normalizePersonName(form.managerName),
      email: normalizeEmail(form.email),
      contactNumber: normalizedPhone || undefined,
      barangay: form.barangay,
      address: form.address.trim(),
      enterpriseId: form.enterpriseId.trim() || undefined,
      ...(location
        ? {
            latitude: location.latitude,
            longitude: location.longitude,
            locationSource: location.source,
            locationConfidence: location.confidence ?? undefined,
            geocodedAddress: location.displayAddress,
          }
        : {}),
    };
    createMutation.mutate(payload);
  };

  return (
    <>
      <ModalFrame title="Register Enterprise" onClose={isFullMapOpen ? () => setIsFullMapOpen(false) : onClose} maxWidthClassName="max-w-5xl">
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-5 md:grid-cols-2">
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
          <FormField
            name="managerName"
            label="Contact Person / Manager"
            value={form.managerName}
            onChange={(value) => updateField("managerName", value)}
            error={errors.managerName}
            required
            autoComplete="name"
          />
          <FormField name="email" label="Contact Email" type="email" value={form.email} onChange={(value) => updateField("email", value)} error={errors.email} required autoComplete="email" />
          <ContactNumberField name="contactNumber" label="Contact Number" value={form.contactLocal} onChange={(value) => updateField("contactLocal", value)} error={errors.contactLocal} />
          <FormField name="enterpriseId" label="Enterprise ID Seed" placeholder="Leave blank to use enterprise name" value={form.enterpriseId} onChange={(value) => updateField("enterpriseId", value)} />
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

          <div className="rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.68)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.7)_100%)] p-4 shadow-sm ring-1 ring-white md:col-span-2">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">Map Location</p>
                <p className="mt-1 text-sm text-slate-500">{location ? getLocationSummary(location) : "No marker confirmed yet. Locate the address or click inside San Pedro."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <BoundaryToggleButton showBoundaries={showBoundaries} onClick={() => setShowBoundaries((current) => !current)} />
                <button
                  type="button"
                  onClick={() => setIsFullMapOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50"
                >
                  <Maximize2 size={15} />
                  Full Map View
                </button>
                <button
                  type="button"
                  onClick={handleLocateAddress}
                  disabled={geocodeMutation.isPending}
                  className="bg-tanaw-green inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70"
                >
                  <LocateFixed size={15} />
                  {geocodeMutation.isPending ? "Locating..." : "Locate Address"}
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <LocationPicker
                location={location}
                isResolvingAddress={reverseGeocodeMutation.isPending}
                mapId="enterprise-location-picker"
                mapHeightClassName="h-80"
                showBoundaries={showBoundaries}
                resizeSignal={showBoundaries ? "boundaries-on" : "boundaries-off"}
                onBoundaryDetection={applyBoundaryDetection}
                onChange={applySelectedLocation}
                onReject={handleLocationRejected}
              />
              <LocationStatusPanel address={form.address} barangay={form.barangay} detectedBarangay={detectedBarangay} location={location} locationError={locationError} locationNotice={locationNotice} />
            </div>

            {locationError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{locationError}</span>
              </div>
            )}
          </div>

          <button
            disabled={createMutation.isPending}
            className="bg-tanaw-green rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(5,91,37,0.22)] transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70 md:col-span-2"
          >
            {createMutation.isPending ? "Saving..." : "Save Enterprise"}
          </button>
        </form>
      </ModalFrame>

      <AnimatePresence>
        {isFullMapOpen && (
          <FullMapView
            address={form.address}
            barangay={form.barangay}
            detectedBarangay={detectedBarangay}
            isLocating={geocodeMutation.isPending}
            isResolvingAddress={reverseGeocodeMutation.isPending}
            location={location}
            locationError={locationError}
            locationNotice={locationNotice}
            showBoundaries={showBoundaries}
            onBoundaryDetection={applyBoundaryDetection}
            onChange={applySelectedLocation}
            onClose={() => setIsFullMapOpen(false)}
            onLocateAddress={handleLocateAddress}
            onReject={handleLocationRejected}
            onToggleBoundaries={() => setShowBoundaries((current) => !current)}
          />
        )}
      </AnimatePresence>
    </>
  );

  function updateField<FieldName extends keyof EnterpriseFormState>(field: FieldName, value: EnterpriseFormState[FieldName]) {
    if (field === "address") {
      addressWasEditedRef.current = true;
    }
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function applySelectedLocation(nextLocation: LocationDraft, barangayDetection?: BarangayPointResolution) {
    const barangayName = barangayDetection?.barangayName ?? null;
    locationStateRef.current = nextLocation;
    detectedBarangayRef.current = barangayName;
    setLocation(nextLocation);
    setDetectedBarangay(barangayName);
    setLocationError(null);
    setLocationNotice(getPolygonLocationNotice(barangayDetection));
    if (barangayName && sanPedroBarangayValues.has(barangayName)) {
      setForm((current) => ({ ...current, barangay: barangayName }));
    }
    reverseGeocodeMutation.mutate({ detectedBarangay: barangayName, location: nextLocation });
  }

  function applyBoundaryDetection(selectedLocation: LocationDraft, barangayDetection: BarangayPointResolution) {
    if (!locationStateRef.current || !locationsMatch(locationStateRef.current, selectedLocation)) return;

    const barangayName = barangayDetection.barangayName;
    detectedBarangayRef.current = barangayName;
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
  isLocating: boolean;
  isResolvingAddress: boolean;
  location: LocationDraft | null;
  locationError: string | null;
  locationNotice: string | null;
  showBoundaries: boolean;
  onBoundaryDetection: (location: LocationDraft, barangayDetection: BarangayPointResolution) => void;
  onChange: (location: LocationDraft, barangayDetection?: BarangayPointResolution) => void;
  onClose: () => void;
  onLocateAddress: () => void;
  onReject: (message: string) => void;
  onToggleBoundaries: () => void;
};

function FullMapView({
  address,
  barangay,
  detectedBarangay,
  isLocating,
  isResolvingAddress,
  location,
  locationError,
  locationNotice,
  showBoundaries,
  onBoundaryDetection,
  onChange,
  onClose,
  onLocateAddress,
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
          className="relative z-1501 flex max-h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.42)] ring-1 ring-black/5"
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.985 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="from-tanaw-green to-tanaw-lime h-1.5 bg-linear-to-r via-[#d9b44a]" />
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] px-5 py-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black tracking-[0.18em] text-emerald-700/80 uppercase">Map Location</p>
              <h3 className="text-tanaw-navy mt-1 text-xl leading-tight font-bold">Full Map View</h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">Click inside San Pedro or drag the marker to refine the exact enterprise location.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <BoundaryToggleButton showBoundaries={showBoundaries} onClick={onToggleBoundaries} />
              <button
                type="button"
                onClick={onLocateAddress}
                disabled={isLocating}
                className="bg-tanaw-green inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70"
              >
                <LocateFixed size={15} />
                {isLocating ? "Locating..." : "Locate Address"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="hover:text-tanaw-green focus:ring-tanaw-green/15 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 focus:ring-4 focus:outline-none"
                aria-label="Close full map view"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <LocationPicker
              location={location}
              isResolvingAddress={isResolvingAddress}
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
    <aside className="rounded-2xl border border-emerald-100 bg-white/86 p-4 text-sm shadow-sm ring-1 ring-white">
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
        <SummaryRow label="Block / Lot / Street" value={address || "Will auto-fill when safely detected"} />
        <SummaryRow label="Detected Address" value={location?.displayAddress || "No street-level address detected"} />
        <SummaryRow label="Coordinates" value={location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "No coordinates yet"} />
      </div>

      {(locationNotice || locationError) && (
        <div className={`mt-4 rounded-xl border px-3 py-2 text-xs font-semibold ${locationError ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}>
          {locationError ?? locationNotice}
        </div>
      )}
    </aside>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
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
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50"
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
  if (!barangayDetection) return "Marker placed inside San Pedro. Address details will be checked.";
  if (!barangayDetection.barangayName) return "Marker placed inside San Pedro city bounds. Barangay boundary data is unavailable.";
  if (barangayDetection.isAmbiguous) {
    return `Multiple barangay boundaries matched this marker; using ${barangayDetection.barangayName} by polygon priority.`;
  }
  return `Barangay polygon detected: ${barangayDetection.barangayName}.`;
}

function getReverseGeocoderBarangayNotice(polygonBarangay: string | null, geocoderBarangay: string | null) {
  if (!polygonBarangay || !geocoderBarangay) return "";
  if (normalizeBarangayForComparison(polygonBarangay) === normalizeBarangayForComparison(geocoderBarangay)) return "";
  return ` Reverse geocoding suggested ${geocoderBarangay}, but polygon detection kept ${polygonBarangay}.`;
}

function shouldUseDetectedAddress(currentAddress: string, nextAddress: string | null, lastAutoAddress: string, addressWasEdited: boolean) {
  if (!nextAddress) return false;

  const normalizedCurrent = normalizeAddressForComparison(currentAddress);
  if (!normalizedCurrent) return true;
  if (!addressWasEdited) return true;

  return normalizedCurrent === normalizeAddressForComparison(lastAutoAddress);
}

function normalizeDetectedAddress(value: string | null | undefined, detectedBarangay: string | null) {
  if (!value) return null;

  const segments = value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !/^(barangay\s+)?san pedro$/i.test(segment))
    .filter((segment) => !/^laguna$/i.test(segment))
    .filter((segment) => !/^4023$/i.test(segment))
    .filter((segment) => !/^philippines$/i.test(segment));

  const cleaned = segments[0]?.replace(/\s+/g, " ").trim();
  if (!cleaned || /^\d+(\.\d+)?,\s*\d+(\.\d+)?$/.test(cleaned)) return null;
  if (/^(san pedro|laguna|philippines)$/i.test(cleaned)) return null;
  if (isBarangayOnlyAddress(cleaned, detectedBarangay)) return null;
  return cleaned;
}

function normalizeAddressForComparison(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isBarangayOnlyAddress(value: string, detectedBarangay: string | null) {
  const normalizedValue = normalizeBarangayForComparison(value);
  const barangayNames = detectedBarangay ? [detectedBarangay, ...sanPedroBarangays] : sanPedroBarangays;
  return barangayNames.some((barangay) => normalizeBarangayForComparison(barangay) === normalizedValue);
}

function normalizeBarangayForComparison(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bbarangay\b/g, "")
    .replace(/\bbrgy\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function validateEnterpriseForm(form: EnterpriseFormState) {
  const errors: EnterpriseFormErrors = {};
  const enterpriseName = form.enterpriseName.trim();
  const emailError = validateEmail(form.email);
  const managerNameError = validatePersonName(form.managerName, "Contact person");
  const phoneError = validatePhilippineContactNumber(form.contactLocal ? `+63${form.contactLocal}` : "", false);

  if (!enterpriseName) errors.enterpriseName = "Enterprise name is required.";
  if (enterpriseName && enterpriseName.length < 2) errors.enterpriseName = "Enterprise name must be at least 2 characters.";
  if (!enterpriseCategoryValues.has(form.category)) errors.category = "Choose a valid enterprise type.";
  if (managerNameError) errors.managerName = managerNameError;
  if (emailError) errors.email = emailError;
  if (phoneError) errors.contactLocal = phoneError;
  if (!form.address.trim()) errors.address = "Address is required.";
  if (!sanPedroBarangayValues.has(form.barangay)) errors.barangay = "Choose a valid barangay.";

  return errors;
}
