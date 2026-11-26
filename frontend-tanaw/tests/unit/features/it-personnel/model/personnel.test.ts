import { describe, expect, it } from "vitest";
import {
  accessOf,
  describeAccess,
  describeLastSignIn,
  emailChangeCallouts,
  emailChangeEffect,
  filterPersonnel,
  lockedRoleReason,
  personnelActions,
  personnelChanges,
  personnelRoleCounts,
  personnelTag,
  toPersonnelAccounts,
  type PersonnelAccount,
  type PersonnelChangeRequest,
} from "@/features/it-personnel/model";

const formats = { dateFormat: "MMM d, yyyy", timeFormat: "12-hour" } as const;

function person(overrides: Partial<PersonnelAccount> & Pick<PersonnelAccount, "id">): PersonnelAccount {
  return {
    email: `${overrides.id}@lgu.example.test`,
    phone: null,
    firstName: "Test",
    lastName: overrides.id,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId: null,
    gatewayStatus: null,
    buildingCapacity: 0,
    displayName: `Test ${overrides.id}`,
    role: "staff",
    title: "LGU Staff",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2026-10-01T00:00:00Z",
    lastLoginAt: null,
    invitation: null,
    deactivatedAt: null,
    deactivatedByName: null,
    ...overrides,
  };
}

function emailRequest(overrides: Partial<PersonnelChangeRequest> = {}): PersonnelChangeRequest {
  return {
    type: "businessEmail",
    label: "Business email",
    requestedValue: "new@lgu.example.test",
    requestedAt: "2026-11-20T02:00:00Z",
    requestId: "req-1",
    status: "verified",
    isVerified: true,
    canApprove: true,
    expiresAt: null,
    requestedByName: null,
    requestedByAccountId: null,
    ...overrides,
  };
}

const firstIt = person({ id: "first", role: "it", isProtectedDefault: true, displayName: "Ana Reyes" });
const otherIt = person({ id: "carlo", role: "it", displayName: "Carlo Mendoza", email: "carlo@lgu.example.test" });
const admin = person({ id: "admin", role: "admin", displayName: "LGU Admin" });
const secondAdmin = person({ id: "admin2", role: "admin", displayName: "Second Admin" });
const staff = person({ id: "mark", role: "staff", displayName: "Mark Dela Cruz", email: "mark.delacruz@lgu.example.test" });
const invited = person({
  id: "grace",
  role: "staff",
  isActivated: false,
  displayName: "Grace Bautista",
  invitation: { sentAt: "2026-11-22T02:00:00Z", expiresAt: "2026-11-23T02:00:00Z", expired: false },
});
const deactivated = person({ id: "paolo", role: "staff", status: "inactive", displayName: "Paolo Santos", deactivatedAt: "2026-10-31T03:00:00Z", deactivatedByName: "Carlo Mendoza" });
const everyone = [firstIt, otherIt, admin, secondAdmin, staff, invited, deactivated];

describe("personnel filters and counts", () => {
  it("hides deactivated accounts until asked for", () => {
    expect(filterPersonnel(everyone, { query: "", role: "all", showDeactivated: false }).map((a) => a.id)).not.toContain("paolo");
    expect(filterPersonnel(everyone, { query: "", role: "all", showDeactivated: true }).map((a) => a.id)).toContain("paolo");
  });

  it("filters by role and by name or email, ignoring case and spaces", () => {
    expect(filterPersonnel(everyone, { query: "", role: "it", showDeactivated: false }).map((a) => a.id)).toEqual(["first", "carlo"]);
    expect(filterPersonnel(everyone, { query: "  DELA cruz ", role: "all", showDeactivated: false }).map((a) => a.id)).toEqual(["mark"]);
    expect(filterPersonnel(everyone, { query: "carlo@lgu", role: "all", showDeactivated: false }).map((a) => a.id)).toEqual(["carlo"]);
    expect(filterPersonnel(everyone, { query: "carlo", role: "staff", showDeactivated: false })).toEqual([]);
  });

  it("counts each role over the visible accounts", () => {
    expect(personnelRoleCounts(everyone, false)).toEqual({ all: 6, admin: 2, staff: 2, it: 2 });
    expect(personnelRoleCounts(everyone, true)).toEqual({ all: 7, admin: 2, staff: 3, it: 2 });
  });

  it("fills a missing change-request list", () => {
    const [account] = toPersonnelAccounts([{ ...staff, profileChangeRequests: undefined as unknown as [] }]);
    expect(account?.profileChangeRequests).toEqual([]);
  });
});

describe("access labels", () => {
  it("reads active, invited and deactivated states", () => {
    expect(accessOf(staff)).toBe("active");
    expect(accessOf(invited)).toBe("invited");
    expect(accessOf(deactivated)).toBe("deactivated");
    expect(accessOf({ status: "inactive", isActivated: false })).toBe("deactivated");
  });

  it("describes each access state with its sub-line", () => {
    expect(describeAccess(staff, formats)).toEqual({ access: "active", label: "Active", detail: "Can sign in" });
    expect(describeAccess(invited, formats)).toEqual({ access: "invited", label: "Invitation sent", detail: "Sent Nov 22, 2026, expires Nov 23, 2026" });
    expect(describeAccess({ ...invited, invitation: { ...invited.invitation!, expired: true } }, formats).detail).toBe("Invitation expired");
    expect(describeAccess({ ...invited, invitation: null }, formats).detail).toBe("Waiting for them to set a password");
    expect(describeAccess(deactivated, formats)).toEqual({ access: "deactivated", label: "Deactivated", detail: "Turned off Oct 31, 2026 by Carlo Mendoza" });
    expect(describeAccess({ ...deactivated, deactivatedAt: null, deactivatedByName: null }, formats).detail).toBe("Turned off");
  });

  it("uses the system date format", () => {
    expect(describeAccess(deactivated, { dateFormat: "yyyy-MM-dd", timeFormat: "24-hour" }).detail).toBe("Turned off 2026-10-31 by Carlo Mendoza");
  });

  it("shows the last sign-in in the system formats, or Never", () => {
    expect(describeLastSignIn(staff, formats)).toBe("Never");
    expect(describeLastSignIn({ lastLoginAt: "2026-11-25T07:38:00Z" }, formats)).toBe("Nov 25, 2026, 3:38 PM");
    expect(describeLastSignIn({ lastLoginAt: "2026-11-25T07:38:00Z" }, { dateFormat: "d MMM yyyy", timeFormat: "24-hour" })).toBe("25 Nov 2026, 15:38");
  });
});

describe("tags", () => {
  it("marks the viewer and the first IT account", () => {
    expect(personnelTag(firstIt, "first")).toBe("You · First IT account");
    expect(personnelTag(firstIt, "carlo")).toBe("First IT account");
    expect(personnelTag(otherIt, "carlo")).toBe("You");
    expect(personnelTag(staff, "carlo")).toBeNull();
    expect(personnelTag(staff, null)).toBeNull();
  });
});

describe("row actions and lock rules", () => {
  it("lets IT edit and deactivate an ordinary active account", () => {
    expect(personnelActions(staff, everyone, "carlo")).toEqual({ canEdit: true, resendLabel: null, canDeactivate: true, canActivate: false, lockNote: null });
  });

  it("protects the first IT account", () => {
    expect(personnelActions(firstIt, everyone, "carlo")).toMatchObject({ canEdit: false, canDeactivate: false, lockNote: "Protected" });
  });

  it("never lets you turn off your own account", () => {
    expect(personnelActions(otherIt, everyone, "carlo")).toMatchObject({ canEdit: true, canDeactivate: false, lockNote: "You" });
  });

  it("keeps the last active IT account", () => {
    const accounts = [otherIt, staff, admin, { ...firstIt, status: "inactive" as const }];
    expect(personnelActions(otherIt, accounts, "admin")).toMatchObject({ canDeactivate: false, lockNote: "Last active IT account" });
    const twoIt = [...accounts, person({ id: "it2", role: "it" })];
    expect(personnelActions(otherIt, twoIt, "admin")).toMatchObject({ canDeactivate: true, lockNote: null });
  });

  it("does not count invited IT accounts as active", () => {
    const accounts = [otherIt, person({ id: "it-invited", role: "it", isActivated: false })];
    expect(personnelActions(otherIt, accounts, "someone")).toMatchObject({ lockNote: "Last active IT account" });
  });

  it("keeps the last active Admin account", () => {
    expect(personnelActions(admin, [admin, staff, otherIt], "carlo")).toMatchObject({ canDeactivate: false, lockNote: "Last active Admin account" });
    expect(personnelActions(admin, everyone, "carlo")).toMatchObject({ canDeactivate: true, lockNote: null });
  });

  it("offers a resend for invitations and a new link once expired", () => {
    expect(personnelActions(invited, everyone, "carlo")).toEqual({ canEdit: true, resendLabel: "Send invitation again", canDeactivate: false, canActivate: false, lockNote: null });
    const expired = { ...invited, invitation: { ...invited.invitation!, expired: true } };
    expect(personnelActions(expired, everyone, "carlo").resendLabel).toBe("Send a new link");
  });

  it("offers Activate, and nothing else, on deactivated accounts", () => {
    expect(personnelActions(deactivated, everyone, "carlo")).toEqual({ canEdit: false, resendLabel: null, canDeactivate: false, canActivate: true, lockNote: null });
  });

  it("locks the role of your own IT account and of the last active IT account", () => {
    expect(lockedRoleReason(otherIt, everyone, "carlo")).toBe("You cannot remove your own IT access.");
    expect(lockedRoleReason(otherIt, [otherIt, staff], "admin")).toBe("This is the last active IT account, so its role stays IT.");
    expect(lockedRoleReason(otherIt, everyone, "admin")).toBeNull();
    expect(lockedRoleReason(staff, everyone, "carlo")).toBeNull();
  });
});

describe("email change callouts", () => {
  it("lists open sign-in email changes with the right next step", () => {
    const accounts = [
      { ...otherIt, profileChangeRequests: [emailRequest({ requestedByAccountId: "carlo", requestedByName: "Carlo Mendoza" })] },
      { ...staff, profileChangeRequests: [emailRequest({ requestedValue: "mark@new.example.test", canApprove: false, requestedByAccountId: "carlo", requestedByName: "Carlo Mendoza" })] },
      { ...admin, profileChangeRequests: [emailRequest({ status: "pending_verification", isVerified: false, canApprove: false, requestedValue: "admin@new.example.test" })] },
      { ...secondAdmin, profileChangeRequests: [emailRequest({ status: "expired" })] },
      { ...invited, profileChangeRequests: [emailRequest({ type: "contactNumber" })] },
    ];
    expect(emailChangeCallouts(accounts)).toEqual([
      {
        accountId: "carlo",
        title: "Carlo Mendoza asked to change the sign-in email",
        from: "carlo@lgu.example.test",
        to: "new@lgu.example.test",
        verified: true,
        canApprove: true,
        status: "The new address is verified.",
      },
      {
        accountId: "mark",
        title: "Carlo Mendoza asked to change Mark Dela Cruz's sign-in email",
        from: "mark.delacruz@lgu.example.test",
        to: "mark@new.example.test",
        verified: true,
        canApprove: false,
        status: "The new address is verified. Another IT account has to approve it.",
      },
      {
        accountId: "admin",
        title: "LGU Admin asked to change the sign-in email",
        from: "admin@lgu.example.test",
        to: "admin@new.example.test",
        verified: false,
        canApprove: false,
        status: "Waiting for the new address to be verified.",
      },
    ]);
  });
});

describe("edit review", () => {
  it("lists what an edit changes, with the portal's role names", () => {
    const account = { ...staff, firstName: "Mark", lastName: "Dela Cruz", phone: null };
    expect(personnelChanges(account, { firstName: "Mark", lastName: "Dela Cruz", email: account.email, role: "staff" })).toEqual([]);
    expect(personnelChanges(account, { firstName: "Mark", lastName: "D. Cruz", email: "m@lgu.example.test", phone: "+639171234567", role: "it" })).toEqual([
      { label: "Name", from: "Mark Dela Cruz", to: "Mark D. Cruz" },
      { label: "Work email", from: account.email, to: "m@lgu.example.test" },
      { label: "Phone", from: "Not set", to: "+639171234567" },
      { label: "Role", from: "Staff", to: "IT" },
    ]);
  });

  it("says how a new email takes effect", () => {
    expect(emailChangeEffect(staff)).toBe("verify");
    expect(emailChangeEffect(invited)).toBe("immediate");
  });
});
