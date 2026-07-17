import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import toast from "react-hot-toast/headless";
import { ContactNumberField, FormField, ModalFrame, SearchableDropdownField } from "@/shared/components/ui";
import { type CreateLguAccountPayload, createLguAccount } from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { normalizeEmail, normalizePersonName, normalizePhilippineContactNumber, validateEmail, validatePersonName, validatePhilippineContactNumber } from "@/shared/utils/accountValidation";

type CreateLguAccountModalProps = {
  onClose: () => void;
};

type LguFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phoneLocal: string;
  role: CreateLguAccountPayload["role"];
};

type LguFormErrors = Partial<Record<keyof LguFormState, string>>;

const allowedLguRoles = ["staff", "it", "admin"] satisfies CreateLguAccountPayload["role"][];

export function CreateLguAccountModal({ onClose }: CreateLguAccountModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LguFormState>({
    firstName: "",
    lastName: "",
    email: "",
    phoneLocal: "",
    role: "staff",
  });
  const [errors, setErrors] = useState<LguFormErrors>({});
  const createMutation = useMutation({
    mutationFn: createLguAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }),
        queryClient.invalidateQueries({ queryKey: ["email-deliveries"] }),
      ]);
      toast.success("LGU account created; activation email queued");
      onClose();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to create LGU account")),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateLguForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const normalizedPhone = form.phoneLocal ? normalizePhilippineContactNumber(`+63${form.phoneLocal}`) : "";
    const payload: CreateLguAccountPayload = {
      firstName: normalizePersonName(form.firstName),
      lastName: normalizePersonName(form.lastName),
      email: normalizeEmail(form.email),
      phone: normalizedPhone || undefined,
      role: form.role,
    };
    createMutation.mutate(payload);
  };

  return (
    <ModalFrame title="Create LGU Account" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FormField name="firstName" label="First Name" value={form.firstName} onChange={(value) => updateField("firstName", value)} error={errors.firstName} required autoComplete="given-name" />
        <FormField name="lastName" label="Last Name" value={form.lastName} onChange={(value) => updateField("lastName", value)} error={errors.lastName} required autoComplete="family-name" />
        <FormField name="email" label="Email Address" type="email" value={form.email} onChange={(value) => updateField("email", value)} error={errors.email} required autoComplete="email" />
        <ContactNumberField name="phone" label="Contact Number" value={form.phoneLocal} onChange={(value) => updateField("phoneLocal", value)} error={errors.phoneLocal} />
        <div className="md:col-span-2">
          <SearchableDropdownField
            name="role"
            label="Role"
            options={[
              ["staff", "LGU Staff"],
              ["it", "IT Personnel"],
              ["admin", "Admin"],
            ]}
            value={form.role}
            onChange={(value) => updateField("role", value as CreateLguAccountPayload["role"])}
            error={errors.role}
            required
          />
        </div>
        <div className="tanaw-account-info-banner flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/80 p-4 ring-1 ring-white md:col-span-2 dark:border-emerald-400/25 dark:bg-[#0d2428] dark:ring-emerald-200/5">
          <span className="bg-tanaw-green mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-1 dark:ring-emerald-300/20">
            <Info size={15} aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-emerald-800 dark:text-emerald-100/85">
            Once this account is saved, TANAW will queue a secure activation link for the registered email. The user will choose a private password on the activation page before signing in.
          </p>
        </div>
        <button
          disabled={createMutation.isPending}
          className="bg-tanaw-green rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(5,91,37,0.22)] transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70 md:col-span-2"
        >
          {createMutation.isPending ? "Creating..." : "Create LGU Account"}
        </button>
      </form>
    </ModalFrame>
  );

  function updateField<FieldName extends keyof LguFormState>(field: FieldName, value: LguFormState[FieldName]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }
}

function validateLguForm(form: LguFormState) {
  const errors: LguFormErrors = {};
  const firstNameError = validatePersonName(form.firstName, "First name");
  const lastNameError = validatePersonName(form.lastName, "Last name");
  const emailError = validateEmail(form.email);
  const phoneError = validatePhilippineContactNumber(form.phoneLocal ? `+63${form.phoneLocal}` : "", false);

  if (firstNameError) errors.firstName = firstNameError;
  if (lastNameError) errors.lastName = lastNameError;
  if (emailError) errors.email = emailError;
  if (phoneError) errors.phoneLocal = phoneError;
  if (!allowedLguRoles.includes(form.role)) errors.role = "Choose a valid role.";

  return errors;
}
