import { type FormEvent, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Pencil, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ContactNumberField, FormField, ModalFrame, SearchableDropdownField, type DropdownOption } from "@/shared/components/ui";
import { type AccountSummary, type UpdateLguAccountPayload, updateLguAccount } from "@/shared/services/accountManagement";
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
import type { LguStatusFilter } from "../types";
import { lguRoleLabel } from "../utils";

type LguAccountDetailsModalProps = {
  account: AccountSummary;
  onClose: () => void;
  onAccountUpdated: (account: AccountSummary) => void;
  onResendActivation: (account: AccountSummary) => void;
  onRequestStatusChange: (account: AccountSummary, nextStatus: LguStatusFilter) => void;
};

type LguEditState = {
  firstName: string;
  lastName: string;
  email: string;
  phoneLocal: string;
  role: UpdateLguAccountPayload["role"];
  status: UpdateLguAccountPayload["status"];
};

type LguEditErrors = Partial<Record<keyof LguEditState, string>>;

type PendingSave = {
  payload: UpdateLguAccountPayload;
  changes: string[];
};

const allowedLguRoles = ["staff", "it", "admin"] satisfies UpdateLguAccountPayload["role"][];
const allowedStatusValues = ["active", "inactive"] satisfies UpdateLguAccountPayload["status"][];

export function LguAccountDetailsModal({ account, onClose, onAccountUpdated, onResendActivation, onRequestStatusChange }: LguAccountDetailsModalProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<LguEditState>(() => getInitialForm(account));
  const [errors, setErrors] = useState<LguEditErrors>({});
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const isProtected = account.isProtectedDefault;
  const nextStatus = account.status === "active" ? "inactive" : "active";

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateLguAccountPayload) => updateLguAccount(account.id, payload),
    onSuccess: async (updatedAccount, payload) => {
      const activationEmailQueued = !account.isActivated && updatedAccount.status === "active" && (payload.email !== account.email || account.status === "inactive");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] }),
        ...(activationEmailQueued ? [queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }), queryClient.invalidateQueries({ queryKey: ["email-deliveries"] })] : []),
      ]);
      onAccountUpdated(updatedAccount);
      setForm(getInitialForm(updatedAccount));
      setPendingSave(null);
      setIsEditing(false);
      toast.success(activationEmailQueued ? "LGU account updated; activation email queued" : "LGU account updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update LGU account")),
  });

  const details = useMemo(
    () => [
      ["Name", account.displayName],
      ["Email", account.email],
      ["Role", lguRoleLabel[account.role] ?? account.role],
      ["Phone", account.phone ?? "Not provided"],
      ["Status", account.status],
      ["Last Login", account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : "Never"],
      ["Created", new Date(account.createdAt).toLocaleString()],
      ["Activation", account.isActivated ? "Complete" : "Pending"],
    ],
    [account],
  );

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateLguEditForm(form);
    setErrors(nextErrors);
    setPendingSave(null);
    if (Object.keys(nextErrors).length > 0) return;

    const normalizedPhone = form.phoneLocal ? normalizePhilippineContactNumber(`+63${form.phoneLocal}`) : "";
    const payload: UpdateLguAccountPayload = {
      firstName: normalizePersonName(form.firstName),
      lastName: normalizePersonName(form.lastName),
      email: normalizeEmail(form.email),
      phone: normalizedPhone || undefined,
      role: form.role,
      status: form.status,
    };
    const changes = getLguChanges(account, payload);
    if (changes.length === 0) {
      toast("No account changes to save.");
      return;
    }
    setPendingSave({ payload, changes });
  };

  return (
    <ModalFrame title="LGU Account Details" onClose={onClose} maxWidthClassName="max-w-4xl" eyebrow="Accounts Management">
      <div className="space-y-6">
        <section className="rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-wide text-emerald-700 uppercase">{lguRoleLabel[account.role] ?? account.role}</p>
              <h3 className="mt-1 text-2xl font-black text-slate-950">{account.displayName}</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">{account.email}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                account.status === "inactive" ? "bg-slate-100 text-slate-600" : account.isActivated ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {account.status === "inactive" ? "inactive" : account.isActivated ? "active" : "pending activation"}
            </span>
          </div>
          {isProtected && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-white/80 p-3 text-sm font-semibold text-emerald-900">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <span>Startup-seeded system account is protected.</span>
            </div>
          )}
        </section>

        {!isEditing ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {details.map(([label, value]) => (
                <DetailCard key={label} label={label} value={value} />
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-3 text-xs font-black tracking-wide text-slate-500 uppercase">Account Actions</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  disabled={isProtected}
                  className="focus:ring-tanaw-green/15 bg-tanaw-green inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:hover:translate-y-0"
                >
                  <Pencil size={16} />
                  Edit account information
                </button>
                {!account.isActivated && account.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => onResendActivation(account)}
                    disabled={isProtected}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-bold text-amber-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-amber-100 focus:outline-none disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 disabled:hover:translate-y-0"
                  >
                    <KeyRound size={16} />
                    Resend activation email
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRequestStatusChange(account, nextStatus)}
                  disabled={isProtected}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-slate-100 focus:outline-none disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 disabled:hover:translate-y-0"
                >
                  {account.status === "active" ? <XCircle size={16} /> : <UserCheck size={16} />}
                  {account.status === "active" ? "Deactivate account" : "Reactivate account"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <form onSubmit={handleEditSubmit} noValidate className="space-y-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField name="firstName" label="First Name" value={form.firstName} onChange={(value) => updateField("firstName", value)} error={errors.firstName} required />
              <FormField name="lastName" label="Last Name" value={form.lastName} onChange={(value) => updateField("lastName", value)} error={errors.lastName} required />
              <FormField name="email" label="Email Address" type="email" value={form.email} onChange={(value) => updateField("email", value)} error={errors.email} required />
              <ContactNumberField name="phone" label="Contact Number" value={form.phoneLocal} onChange={(value) => updateField("phoneLocal", value)} error={errors.phoneLocal} />
              <SearchableDropdownField
                name="role"
                label="Role"
                options={
                  [
                    ["staff", "LGU Staff"],
                    ["it", "IT Personnel"],
                    ["admin", "Admin"],
                  ] satisfies DropdownOption[]
                }
                value={form.role}
                onChange={(value) => updateField("role", value as LguEditState["role"])}
                error={errors.role}
                required
              />
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
                onChange={(value) => updateField("status", value as LguEditState["status"])}
                error={errors.status}
                required
              />
            </div>

            {pendingSave && (
              <ConfirmationPanel
                title="Are you sure you want to save these account changes?"
                changes={pendingSave.changes}
                isPending={updateMutation.isPending}
                onCancel={() => setPendingSave(null)}
                onConfirm={() => updateMutation.mutate(pendingSave.payload)}
              />
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setForm(getInitialForm(account));
                  setErrors({});
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
      </div>
    </ModalFrame>
  );

  function updateField<FieldName extends keyof LguEditState>(field: FieldName, value: LguEditState[FieldName]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
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

function ConfirmationPanel({ title, changes, isPending, onCancel, onConfirm }: { title: string; changes: string[]; isPending: boolean; onCancel: () => void; onConfirm: () => void }) {
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
              {isPending ? "Saving..." : "Confirm Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getInitialForm(account: AccountSummary): LguEditState {
  const [fallbackFirstName, ...restName] = account.displayName.split(" ");
  return {
    firstName: account.firstName ?? fallbackFirstName ?? "",
    lastName: account.lastName ?? restName.join(" ") ?? "",
    email: account.email,
    phoneLocal: account.phone ? toPhilippineLocalDigits(account.phone) : "",
    role: account.role as LguEditState["role"],
    status: account.status,
  };
}

function validateLguEditForm(form: LguEditState) {
  const errors: LguEditErrors = {};
  const firstNameError = validatePersonName(form.firstName, "First name");
  const lastNameError = validatePersonName(form.lastName, "Last name");
  const emailError = validateEmail(form.email);
  const phoneError = validatePhilippineContactNumber(form.phoneLocal ? `+63${form.phoneLocal}` : "", false);

  if (firstNameError) errors.firstName = firstNameError;
  if (lastNameError) errors.lastName = lastNameError;
  if (emailError) errors.email = emailError;
  if (phoneError) errors.phoneLocal = phoneError;
  if (!allowedLguRoles.includes(form.role)) errors.role = "Choose a valid role.";
  if (!allowedStatusValues.includes(form.status)) errors.status = "Choose a valid status.";

  return errors;
}

function getLguChanges(account: AccountSummary, payload: UpdateLguAccountPayload) {
  const changes: string[] = [];
  if ((account.firstName ?? "") !== payload.firstName) changes.push(`First name: ${account.firstName ?? "Not provided"} -> ${payload.firstName}`);
  if ((account.lastName ?? "") !== payload.lastName) changes.push(`Last name: ${account.lastName ?? "Not provided"} -> ${payload.lastName}`);
  if (account.email !== payload.email) changes.push(`Email: ${account.email} -> ${payload.email}`);
  if ((account.phone ?? "") !== (payload.phone ?? "")) changes.push(`Contact number: ${account.phone ?? "Not provided"} -> ${payload.phone ?? "Not provided"}`);
  if (account.role !== payload.role) changes.push(`Role: ${lguRoleLabel[account.role] ?? account.role} -> ${lguRoleLabel[payload.role]}`);
  if (account.status !== payload.status) changes.push(`Status: ${account.status} -> ${payload.status}`);
  return changes;
}
