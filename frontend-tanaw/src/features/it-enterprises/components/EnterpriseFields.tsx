import { useId, useState, type ReactNode } from "react";
import { attractionClassifications, otherAttractionCode } from "@/contracts/generated/attractions";
import type { EnterpriseFormErrors, EnterpriseFormState } from "@/features/enterprise-accounts/model";
import { sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import { Input, Select, cn, controlClassName } from "@/shared/ui-kit";
import { PERSON_NAME_MAX_LENGTH, PHILIPPINE_MOBILE_ERROR, normalizeMiddleInitial, toPhilippineLocalDigits } from "@/shared/utils/accountValidation";
import { FieldError, FieldLabel } from "./StateText";

export type TextField = Exclude<keyof EnterpriseFormState, "openingHours">;

const attractionOptions = attractionClassifications.map((item) => ({
  value: item.code,
  label: item.category,
  meta: `${item.code} · ${item.type}`,
  searchText: `${item.type} ${item.portfolioCategory} ${item.ntdpCode}`,
}));

const barangayOptions = sanPedroBarangays.map((name) => [name, name] as const);

type FieldsProps = {
  form: EnterpriseFormState;
  errors: EnterpriseFormErrors;
  onChange: (field: TextField, value: string) => void;
};

/** One text field with its label and error, wrapped so the form-error helper can find it. */
function TextInput({
  field,
  label,
  form,
  errors,
  onChange,
  type = "text",
  optional = false,
  className,
  ...props
}: FieldsProps & {
  field: TextField;
  label: string;
  type?: string;
  optional?: boolean;
  className?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  inputMode?: "numeric" | "text" | "email";
  normalize?: (value: string) => string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const { normalize, ...inputProps } = props;
  return (
    <div data-field-name={field} className={className}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        name={field}
        type={type}
        value={form[field]}
        invalid={Boolean(errors[field])}
        aria-describedby={errors[field] ? errorId : undefined}
        required={!optional}
        onChange={(event) => onChange(field, normalize ? normalize(event.target.value) : event.target.value)}
        {...inputProps}
      />
      <FieldError id={errorId}>{errors[field]}</FieldError>
    </div>
  );
}

export function NameField(props: FieldsProps) {
  return <TextInput {...props} field="enterpriseName" label="Enterprise name" placeholder="For example: Cuyab River Eco Park" maxLength={120} />;
}

/** The DOT attraction category, and what it is when "Other". */
export function AttractionFields({ form, errors, onChange, className }: FieldsProps & { className?: string }) {
  const id = useId();
  return (
    <div className={cn("grid gap-4", className)}>
      <div data-field-name="attractionCode">
        <FieldLabel htmlFor={id}>Attraction type</FieldLabel>
        <Select
          id={id}
          name="attractionCode"
          ariaLabel="Attraction type"
          placeholder="Choose a DOT attraction category"
          options={attractionOptions}
          value={form.attractionCode}
          onChange={(value) => onChange("attractionCode", value)}
          error={errors.attractionCode}
          required
          searchable
          searchPlaceholder="Search category, type or code"
          focusOnFormError
        />
      </div>
      {form.attractionCode === otherAttractionCode && (
        <TextInput form={form} errors={errors} onChange={onChange} field="attractionDescription" label="What kind of attraction is it?" maxLength={120} />
      )}
    </div>
  );
}

/** The street address and barangay under the map. */
export function AddressFields({ form, errors, onChange }: FieldsProps) {
  const barangayId = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
      <TextInput form={form} errors={errors} onChange={onChange} field="address" label="Block, lot and street" placeholder="For example: Lakeside Road" maxLength={200} />
      <div data-field-name="barangay">
        <FieldLabel htmlFor={barangayId}>Barangay</FieldLabel>
        <Select
          id={barangayId}
          name="barangay"
          ariaLabel="Barangay"
          placeholder="Choose a barangay"
          options={barangayOptions}
          value={form.barangay}
          onChange={(value) => onChange("barangay", value)}
          error={errors.barangay}
          required
          searchable
          searchPlaceholder="Search barangays"
          focusOnFormError
        />
      </div>
    </div>
  );
}

/** First name, middle initial and last name of the owner or manager. */
export function ManagerFields(props: FieldsProps) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-semibold text-(--tanaw-text-secondary)">Owner or manager</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
        <TextInput {...props} field="managerFirstName" label="First name" autoComplete="given-name" maxLength={PERSON_NAME_MAX_LENGTH} />
        <TextInput {...props} field="managerMiddleInitial" label="M.I." optional autoComplete="additional-name" maxLength={1} normalize={normalizeMiddleInitial} />
        <TextInput {...props} field="managerLastName" label="Last name" autoComplete="family-name" maxLength={PERSON_NAME_MAX_LENGTH} />
      </div>
    </fieldset>
  );
}

/** A Philippine mobile number: +63 and ten digits starting with 9. */
export function ContactNumberInput({ form, errors, onChange }: FieldsProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [typingError, setTypingError] = useState("");
  const error = errors.contactLocal || typingError;
  const update = (value: string) => {
    const digits = toPhilippineLocalDigits(value);
    if ((value && !/^[\d\s+]*$/.test(value)) || (digits && !digits.startsWith("9"))) {
      setTypingError(PHILIPPINE_MOBILE_ERROR);
      return;
    }
    setTypingError("");
    onChange("contactLocal", digits.slice(0, 10));
  };
  return (
    <div data-field-name="contactNumber">
      <FieldLabel htmlFor={id} optional>
        Contact number
      </FieldLabel>
      <div
        className={cn(
          controlClassName,
          "flex h-10 items-stretch overflow-hidden p-0 focus-within:border-(--tanaw-accent-ink) focus-within:ring-4 focus-within:ring-emerald-600/15",
          error && "border-(--tanaw-error)",
        )}
      >
        <span aria-hidden="true" className="flex items-center border-r border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-3 text-sm font-semibold text-(--tanaw-text-secondary)">
          +63
        </span>
        <input
          id={id}
          name="contactNumber"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          data-form-error-focus
          value={form.contactLocal}
          maxLength={10}
          placeholder="9171234567"
          onChange={(event) => update(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-(--tanaw-text) outline-none placeholder:text-(--tanaw-text-placeholder)"
        />
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

export function EmailField({ hint, ...props }: FieldsProps & { hint?: ReactNode }) {
  return (
    <div>
      <TextInput {...props} field="email" label="Owner email" type="email" inputMode="email" autoComplete="email" placeholder="The sign-in invitation goes here" maxLength={254} />
      {hint && <p className="mt-1.5 text-xs text-(--tanaw-text-muted)">{hint}</p>}
    </div>
  );
}

export function CapacityField(props: FieldsProps) {
  return <TextInput {...props} field="buildingCapacity" label="Capacity (people)" type="number" inputMode="numeric" placeholder="100" />;
}
