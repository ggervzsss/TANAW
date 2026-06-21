import { type FormEvent, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, KeyRound, Pencil, UserCheck, XCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ContactNumberField, FormField, ModalFrame, SearchableDropdownField, type DropdownOption } from "@/shared/components/ui";
import { enterpriseCategories, sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import { type AccountSummary, type UpdateEnterpriseAccountPayload, resetAccountPassword, updateAccountStatus, updateEnterpriseAccount } from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import {
  normalizeEmail,
  normalizePersonName,
  normalizePhilippineContactNumber,
  toPhilippineLocalDigits,
  validateEmail,
  validatePersonName,
  validatePhilippineContactNumber,
} from "@/shared/utils/accountValidation";

type EnterpriseDetailsModalProps = {
  enterprise: AccountSummary;
  onClose: () => void;
  onEnterpriseUpdated: (enterprise: AccountSummary) => void;
};

type EnterpriseEditState = {
  enterpriseName: string;
  category: string;
  managerName: string;
  email: string;
  phoneLocal: string;
  barangay: string;
  address: string;
  status: UpdateEnterpriseAccountPayload["status"];
};

type EnterpriseEditErrors = Partial<Record<keyof EnterpriseEditState, string>>;
type ConfirmMode = null | "save" | "reset" | "status";

type PendingSave = {
  payload: UpdateEnterpriseAccountPayload;
  changes: string[];
};

const enterpriseCategoryValues = new Set<string>(enterpriseCategories.map((category) => category.value));
const sanPedroBarangayValues = new Set<string>(sanPedroBarangays);
const allowedStatusValues = ["active", "inactive"] satisfies UpdateEnterpriseAccountPayload["status"][];

export function EnterpriseDetailsModal({ enterprise, onClose, onEnterpriseUpdated }: EnterpriseDetailsModalProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EnterpriseEditState>(() => getInitialForm(enterprise));
  const [errors, setErrors] = useState<EnterpriseEditErrors>({});
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const nextStatus = enterprise.status === "active" ? "inactive" : "active";

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateEnterpriseAccountPayload) => updateEnterpriseAccount(enterprise.id, payload),
    onSuccess: async (updatedEnterprise) => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] });
      onEnterpriseUpdated(updatedEnterprise);
      setForm(getInitialForm(updatedEnterprise));
      setConfirmMode(null);
      setPendingSave(null);
      setIsEditing(false);
      toast.success("Enterprise account updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update enterprise account")),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetAccountPassword(enterprise.id),
    onSuccess: async (updatedEnterprise) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] }), queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] })]);
      onEnterpriseUpdated(updatedEnterprise);
      setConfirmMode(null);
      toast.success("Temporary credentials recorded in Dev Log");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to reset credentials")),
  });

  const statusMutation = useMutation({
    mutationFn: () => updateAccountStatus(enterprise.id, nextStatus),
    onSuccess: async (updatedEnterprise) => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] });
      onEnterpriseUpdated(updatedEnterprise);
      setConfirmMode(null);
      toast.success("Enterprise account status updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update enterprise status")),
  });

  const details = useMemo(
    () => [
      ["Enterprise", enterprise.enterpriseName ?? enterprise.displayName],
      ["Contact Email", enterprise.email],
      ["Contact Number", enterprise.phone ?? "Not provided"],
      ["Contact Manager", enterprise.managerName ?? "Not provided"],
      ["Category", enterprise.category ?? "Not provided"],
      ["Barangay", enterprise.barangay ?? "Not provided"],
      ["Enterprise ID", enterprise.enterpriseId ?? "Pending"],
      ["Registered Address", enterprise.address ?? "Not provided"],
      ["Map Location", enterprise.latitude !== null && enterprise.longitude !== null ? `${enterprise.latitude.toFixed(6)}, ${enterprise.longitude.toFixed(6)}` : "Not pinned"],
      ["Status", enterprise.status],
      ["Created", new Date(enterprise.createdAt).toLocaleString()],
      ["Must Change Password", enterprise.mustChangePassword ? "Yes" : "No"],
    ],
    [enterprise],
  );

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEnterpriseEditForm(form);
    setErrors(nextErrors);
    setConfirmMode(null);
    setPendingSave(null);
    if (Object.keys(nextErrors).length > 0) return;

    const normalizedPhone = form.phoneLocal ? normalizePhilippineContactNumber(`+63${form.phoneLocal}`) : "";
    const payload: UpdateEnterpriseAccountPayload = {
      enterpriseName: form.enterpriseName.trim(),
      category: form.category,
      managerName: normalizePersonName(form.managerName),
      email: normalizeEmail(form.email),
      contactNumber: normalizedPhone || undefined,
      barangay: form.barangay,
      address: form.address.trim(),
      status: form.status,
    };
    const changes = getEnterpriseChanges(enterprise, payload);
    if (changes.length === 0) {
      toast("No enterprise changes to save.");
      return;
    }
    setPendingSave({ payload, changes });
    setConfirmMode("save");
  };

  return (
    <ModalFrame title="Enterprise Details" onClose={onClose} maxWidthClassName="max-w-5xl" eyebrow="Accounts Management">
      <div className="space-y-6">
        <section className="rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="bg-tgreen-dark/10 text-tgreen-dark flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
                <Building2 size={24} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-wide text-emerald-700 uppercase">{enterprise.category ?? "Enterprise Account"}</p>
                <h3 className="mt-1 truncate text-2xl font-black text-slate-950">{enterprise.enterpriseName ?? enterprise.displayName}</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">{enterprise.email}</p>
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${enterprise.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {enterprise.status}
            </span>
          </div>
        </section>

        {!isEditing ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {details.map(([label, value]) => (
                <DetailCard key={label} label={label} value={value} />
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-3 text-xs font-black tracking-wide text-slate-500 uppercase">Enterprise Actions</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="bg-tanaw-green focus:ring-tanaw-green/15 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none"
                >
                  <Pencil size={16} />
                  Edit account information
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmMode("reset")}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-bold text-amber-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-amber-100 focus:outline-none"
                >
                  <KeyRound size={16} />
                  Reset credentials
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmMode("status")}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-slate-100 focus:outline-none"
                >
                  {enterprise.status === "active" ? <XCircle size={16} /> : <UserCheck size={16} />}
                  {enterprise.status === "active" ? "Deactivate enterprise" : "Reactivate enterprise"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <form onSubmit={handleEditSubmit} noValidate className="space-y-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
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
              <FormField name="managerName" label="Contact Person / Manager" value={form.managerName} onChange={(value) => updateField("managerName", value)} error={errors.managerName} required />
              <FormField name="email" label="Contact Email" type="email" value={form.email} onChange={(value) => updateField("email", value)} error={errors.email} required />
              <ContactNumberField name="contactNumber" label="Contact Number" value={form.phoneLocal} onChange={(value) => updateField("phoneLocal", value)} error={errors.phoneLocal} />
              <SearchableDropdownField
                name="barangay"
                label="Barangay"
                options={sanPedroBarangays.map((item): DropdownOption => [item, item])}
                value={form.barangay}
                onChange={(value) => updateField("barangay", value)}
                error={errors.barangay}
                required
              />
              <FormField name="address" label="Block / Lot / Street" value={form.address} onChange={(value) => updateField("address", value)} error={errors.address} required />
              <SearchableDropdownField
                name="status"
                label="Status"
                options={
                  [
                    ["active", "Active"],
                    ["inactive", "Inactive"],
                  ] satisfies DropdownOption[]
                }
                value={form.status}
                onChange={(value) => updateField("status", value as EnterpriseEditState["status"])}
                error={errors.status}
                required
              />
            </div>

            {confirmMode === "save" && pendingSave && (
              <ConfirmationPanel
                title="Are you sure you want to save these enterprise account changes?"
                changes={pendingSave.changes}
                confirmLabel="Confirm Save"
                isPending={updateMutation.isPending}
                onCancel={() => {
                  setConfirmMode(null);
                  setPendingSave(null);
                }}
                onConfirm={() => updateMutation.mutate(pendingSave.payload)}
              />
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setForm(getInitialForm(enterprise));
                  setErrors({});
                  setConfirmMode(null);
                  setPendingSave(null);
                }}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="bg-tanaw-green rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70"
              >
                Review Changes
              </button>
            </div>
          </form>
        )}

        {confirmMode === "reset" && (
          <ConfirmationPanel
            title="Reset enterprise credentials?"
            changes={["The current password will stop working.", "New temporary credentials will be recorded in Dev Log.", "The enterprise user must change the temporary password after signing in."]}
            confirmLabel="Reset Credentials"
            isPending={resetMutation.isPending}
            onCancel={() => setConfirmMode(null)}
            onConfirm={() => resetMutation.mutate()}
          />
        )}

        {confirmMode === "status" && (
          <ConfirmationPanel
            title={nextStatus === "inactive" ? "Deactivate this enterprise account?" : "Reactivate this enterprise account?"}
            changes={[
              nextStatus === "inactive" ? "The enterprise user will not be able to sign in." : "The enterprise user can sign in again if their credentials are valid.",
              `New status: ${nextStatus}`,
            ]}
            confirmLabel={nextStatus === "inactive" ? "Deactivate" : "Reactivate"}
            isPending={statusMutation.isPending}
            onCancel={() => setConfirmMode(null)}
            onConfirm={() => statusMutation.mutate()}
          />
        )}
      </div>
    </ModalFrame>
  );

  function updateField<FieldName extends keyof EnterpriseEditState>(field: FieldName, value: EnterpriseEditState[FieldName]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setConfirmMode(null);
    setPendingSave(null);
  }
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-black tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-sm font-bold wrap-break-word text-slate-900">{value}</p>
    </div>
  );
}

function ConfirmationPanel({
  title,
  changes,
  confirmLabel,
  isPending,
  onCancel,
  onConfirm,
}: {
  title: string;
  changes: string[];
  confirmLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="font-black text-amber-950">{title}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {changes.map((change) => (
              <li key={change} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{change}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onCancel} className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-900 transition hover:bg-amber-100">
              Cancel
            </button>
            <button type="button" disabled={isPending} onClick={onConfirm} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-70">
              {isPending ? "Working..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getInitialForm(enterprise: AccountSummary): EnterpriseEditState {
  return {
    enterpriseName: enterprise.enterpriseName ?? enterprise.displayName,
    category: enterprise.category ?? "",
    managerName: enterprise.managerName ?? "",
    email: enterprise.email,
    phoneLocal: enterprise.phone ? toPhilippineLocalDigits(enterprise.phone) : "",
    barangay: enterprise.barangay ?? "",
    address: enterprise.address ?? "",
    status: enterprise.status,
  };
}

function validateEnterpriseEditForm(form: EnterpriseEditState) {
  const errors: EnterpriseEditErrors = {};
  const enterpriseName = form.enterpriseName.trim();
  const managerNameError = validatePersonName(form.managerName, "Contact person");
  const emailError = validateEmail(form.email);
  const phoneError = validatePhilippineContactNumber(form.phoneLocal ? `+63${form.phoneLocal}` : "", false);

  if (!enterpriseName) errors.enterpriseName = "Enterprise name is required.";
  if (enterpriseName && enterpriseName.length < 2) errors.enterpriseName = "Enterprise name must be at least 2 characters.";
  if (!enterpriseCategoryValues.has(form.category)) errors.category = "Choose a valid enterprise type.";
  if (managerNameError) errors.managerName = managerNameError;
  if (emailError) errors.email = emailError;
  if (phoneError) errors.phoneLocal = phoneError;
  if (!sanPedroBarangayValues.has(form.barangay)) errors.barangay = "Choose a valid barangay.";
  if (!form.address.trim()) errors.address = "Address is required.";
  if (!allowedStatusValues.includes(form.status)) errors.status = "Choose a valid status.";

  return errors;
}

function getEnterpriseChanges(enterprise: AccountSummary, payload: UpdateEnterpriseAccountPayload) {
  const changes: string[] = [];
  if ((enterprise.enterpriseName ?? enterprise.displayName) !== payload.enterpriseName)
    changes.push(`Enterprise name: ${enterprise.enterpriseName ?? enterprise.displayName} -> ${payload.enterpriseName}`);
  if ((enterprise.category ?? "") !== payload.category) changes.push(`Category: ${enterprise.category ?? "Not provided"} -> ${payload.category}`);
  if ((enterprise.managerName ?? "") !== payload.managerName) changes.push(`Contact person: ${enterprise.managerName ?? "Not provided"} -> ${payload.managerName}`);
  if (enterprise.email !== payload.email) changes.push(`Email: ${enterprise.email} -> ${payload.email}`);
  if ((enterprise.phone ?? "") !== (payload.contactNumber ?? "")) changes.push(`Contact number: ${enterprise.phone ?? "Not provided"} -> ${payload.contactNumber ?? "Not provided"}`);
  if ((enterprise.barangay ?? "") !== payload.barangay) changes.push(`Barangay: ${enterprise.barangay ?? "Not provided"} -> ${payload.barangay}`);
  if ((enterprise.address ?? "") !== payload.address) changes.push("Registered address will be updated.");
  if (enterprise.status !== payload.status) changes.push(`Status: ${enterprise.status} -> ${payload.status}`);
  return changes;
}
