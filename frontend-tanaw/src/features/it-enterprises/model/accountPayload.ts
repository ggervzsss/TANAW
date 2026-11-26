import { toUpdateEnterprisePayload, type EnterpriseFormState } from "@/features/enterprise-accounts/model";
import type { OpeningHours } from "@/features/enterprise-accounts/model/openingHours";
import type { UpdateEnterpriseAccountPayload } from "@/features/enterprise-accounts/services";
import type { LocationDraft } from "@/features/enterprise-accounts/types";
import type { AccountSummary } from "@/shared/types";

/*
 * PATCH /accounts/enterprises/{id} needs every detail on each save. The Details and Opening hours
 * tabs save separately, so each builds the payload from the latest account plus its own changes.
 */

/** The account as it is now, with new opening hours. Null when it has no attraction code to resend. */
export function hoursPayload(account: AccountSummary, openingHours: OpeningHours): UpdateEnterpriseAccountPayload | null {
  const attractionCode = account.attraction?.code;
  if (!attractionCode || !account.barangay || !account.address) return null;
  return {
    enterpriseName: account.enterpriseName ?? account.displayName,
    attractionCode,
    attractionDescription: account.attractionDescription ?? null,
    managerName: account.managerName ?? "",
    email: account.email,
    contactNumber: account.phone ?? undefined,
    barangay: account.barangay,
    address: account.address,
    buildingCapacity: account.buildingCapacity,
    openingHours,
  };
}

/** The details form as a payload that leaves the opening hours as they are (the Hours tab owns them). */
export function detailsPayload(form: EnterpriseFormState, location: LocationDraft | null, account: AccountSummary): UpdateEnterpriseAccountPayload {
  const payload = toUpdateEnterprisePayload(form, location);
  // Only an invited account's email can be corrected here; after activation it changes through a request.
  return { ...payload, email: account.isActivated ? account.email : payload.email, openingHours: undefined };
}
