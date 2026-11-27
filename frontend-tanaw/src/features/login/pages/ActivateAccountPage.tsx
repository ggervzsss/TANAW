import { ShieldCheck } from "lucide-react";
import { AccountActivationCard, AuthHero, AuthStageLayout } from "../components";
import { useAccountActivation } from "../hooks";

export function ActivateAccountPage() {
  const activation = useAccountActivation();

  return (
    <AuthStageLayout
      showParticles
      panelClassName="tanaw-activation-card"
      hero={
        <AuthHero
          icon={<ShieldCheck className="h-8 w-8" aria-hidden="true" />}
          title="Secure your TANAW account"
          copy="Confirm your registered email and create a private password before accessing TANAW."
        />
      }
    >
      <AccountActivationCard {...activation} onChange={activation.updateField} onSubmit={activation.submit} />
    </AuthStageLayout>
  );
}
