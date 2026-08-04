import { AnimatePresence } from "motion/react";
import { ModalFrame } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/types";
import { useEnterpriseDetails } from "../hooks";
import { ConfirmEnterpriseActivationModal, ConfirmEnterpriseStatusModal } from "./EnterpriseAccountConfirmations";
import { EnterpriseDetailsEditForm } from "./EnterpriseDetailsEditForm";
import { EnterpriseDetailsOverview } from "./EnterpriseDetailsOverview";

type EnterpriseDetailsModalProps = {
  enterprise: AccountSummary;
  onClose: () => void;
  onEnterpriseUpdated: (enterprise: AccountSummary) => void;
};

export function EnterpriseDetailsModal({ enterprise, onClose, onEnterpriseUpdated }: EnterpriseDetailsModalProps) {
  const details = useEnterpriseDetails(enterprise, onEnterpriseUpdated);
  return (
    <>
      <ModalFrame title="Enterprise Details" onClose={onClose} maxWidthClassName="max-w-5xl" eyebrow="Accounts Management">
        <div className="space-y-6">
          {details.isEditing ? (
            <EnterpriseDetailsEditForm
              detectedBarangay={details.detectedBarangay}
              enterpriseId={enterprise.id}
              errors={details.errors}
              form={details.form}
              isPending={details.updatePending}
              location={details.location}
              locationError={details.locationError}
              pendingSave={details.pendingSave}
              reviewingSave={details.confirmMode === "save"}
              onBoundaryDetection={details.applyBoundaryDetection}
              onCancel={details.resetForm}
              onCancelReview={() => details.setConfirmMode(null)}
              onConfirmSave={details.confirmSave}
              onFieldChange={details.updateField}
              onLocationChange={details.applySelectedLocation}
              onLocationReject={details.handleLocationRejected}
              onSubmit={details.handleEditSubmit}
            />
          ) : (
            <EnterpriseDetailsOverview
              canChangeStatus={details.canChangeStatus}
              details={details.details}
              enterprise={enterprise}
              onEdit={() => details.setIsEditing(true)}
              onResendActivation={() => details.setConfirmMode("activation")}
              onStatusChange={() => details.setConfirmMode("status")}
            />
          )}
        </div>
      </ModalFrame>
      <AnimatePresence>
        {details.confirmMode === "activation" && (
          <ConfirmEnterpriseActivationModal
            key={`enterprise-activation-${enterprise.id}`}
            enterprise={enterprise}
            isPending={details.activationPending}
            onClose={() => details.setConfirmMode(null)}
            onConfirm={details.resendActivation}
          />
        )}
        {details.confirmMode === "status" && (
          <ConfirmEnterpriseStatusModal
            key={`enterprise-status-${enterprise.id}`}
            enterprise={enterprise}
            nextStatus={details.nextStatus}
            isPending={details.statusPending}
            onClose={() => details.setConfirmMode(null)}
            onConfirm={details.updateStatus}
          />
        )}
      </AnimatePresence>
    </>
  );
}
