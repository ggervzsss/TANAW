import { ContactNumberField, FormField, SearchableDropdownField, type DropdownOption } from "@/shared/components/ui";
import { enterpriseCategories, sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import { PERSON_NAME_MAX_LENGTH, normalizeMiddleInitial } from "@/shared/utils/accountValidation";
import type { EnterpriseFormErrors, EnterpriseFormState } from "../model";

type EnterpriseAccountFieldsProps = {
  errors: EnterpriseFormErrors;
  form: EnterpriseFormState;
  mode: "create" | "edit";
  onChange: (field: keyof EnterpriseFormState, value: string) => void;
  enterpriseId?: string;
  onEnterpriseIdChange?: (value: string) => void;
};

export function EnterpriseAccountFields({ enterpriseId = "", errors, form, mode, onChange, onEnterpriseIdChange }: EnterpriseAccountFieldsProps) {
  return (
    <>
      <FormField name="enterpriseName" label="Enterprise Name" value={form.enterpriseName} onChange={(value) => onChange("enterpriseName", value)} error={errors.enterpriseName} required />
      <SearchableDropdownField
        name="category"
        label="Enterprise Type / Category"
        options={enterpriseCategories.map((category): DropdownOption => [category.value, category.label])}
        value={form.category}
        onChange={(value) => onChange("category", value)}
        error={errors.category}
        required
      />
      <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
        <FormField
          name="managerFirstName"
          label="Contact First Name"
          value={form.managerFirstName}
          onChange={(value) => onChange("managerFirstName", value)}
          error={errors.managerFirstName}
          required
          autoComplete="given-name"
          maxLength={PERSON_NAME_MAX_LENGTH}
        />
        <FormField
          name="managerMiddleInitial"
          label="Middle Initial"
          value={form.managerMiddleInitial}
          onChange={(value) => onChange("managerMiddleInitial", normalizeMiddleInitial(value))}
          error={errors.managerMiddleInitial}
          autoComplete="additional-name"
          maxLength={1}
          helperText="Optional"
        />
        <FormField
          name="managerLastName"
          label="Contact Last Name"
          value={form.managerLastName}
          onChange={(value) => onChange("managerLastName", value)}
          error={errors.managerLastName}
          required
          autoComplete="family-name"
          maxLength={PERSON_NAME_MAX_LENGTH}
        />
      </div>
      <FormField name="email" label="Contact Email" type="email" value={form.email} onChange={(value) => onChange("email", value)} error={errors.email} required autoComplete="email" />
      <ContactNumberField
        name="contactNumber"
        label={mode === "create" ? "Contact Number (Optional)" : "Contact Number"}
        value={form.contactLocal}
        onChange={(value) => onChange("contactLocal", value)}
        error={errors.contactLocal}
      />
      {mode === "create" && (
        <FormField name="enterpriseId" label="Enterprise ID Seed" placeholder="Leave blank to use enterprise name" value={enterpriseId} onChange={(value) => onEnterpriseIdChange?.(value)} />
      )}
      <FormField
        name="buildingCapacity"
        label="Building Capacity"
        type="number"
        value={form.buildingCapacity}
        onChange={(value) => onChange("buildingCapacity", value)}
        error={errors.buildingCapacity}
        required
      />
      {mode === "create" ? (
        <>
          <AddressField form={form} errors={errors} onChange={onChange} />
          <BarangayField form={form} errors={errors} onChange={onChange} />
        </>
      ) : (
        <>
          <BarangayField form={form} errors={errors} onChange={onChange} />
          <AddressField form={form} errors={errors} onChange={onChange} />
        </>
      )}
    </>
  );
}

function AddressField({ errors, form, onChange }: Pick<EnterpriseAccountFieldsProps, "errors" | "form" | "onChange">) {
  return <FormField name="address" label="Block / Lot / Street" value={form.address} onChange={(value) => onChange("address", value)} error={errors.address} required />;
}

function BarangayField({ errors, form, onChange }: Pick<EnterpriseAccountFieldsProps, "errors" | "form" | "onChange">) {
  return (
    <SearchableDropdownField
      name="barangay"
      label="Barangay"
      options={sanPedroBarangays.map((item): DropdownOption => [item, item])}
      value={form.barangay}
      onChange={(value) => onChange("barangay", value)}
      error={errors.barangay}
      required
    />
  );
}
