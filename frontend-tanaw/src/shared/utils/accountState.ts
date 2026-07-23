type ActivatableAccount = {
  isActivated: boolean;
  status: "active" | "inactive";
};

export function canDeactivateAccount(account: ActivatableAccount) {
  return account.status === "active" && account.isActivated;
}
