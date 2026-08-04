import { Check, RefreshCw, Save, Upload } from "lucide-react";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { roleAccessLabel, rolePortalLabel } from "@/shared/constants/roleLabels";
import type { UserRole } from "@/shared/types";
import { PERSON_NAME_MAX_LENGTH } from "@/shared/utils/accountValidation";
import { AccountField, ProfileImageInput } from "../components";
import { useAccountProfileForm } from "../hooks";

export function AccountProfilePage({ role }: { role: UserRole }) {
  const profile = useAccountProfileForm();
  return (
    <PageMotion>
      <PageHeader title="Profile Settings" description="Manage your profile photo and primary contact details." />
      <form onSubmit={profile.save} className="mx-auto max-w-5xl space-y-6">
        <Panel className="overflow-hidden">
          <PanelHeader title="Account Display" icon={Upload} />
          <div className="p-6">
            <div className="mb-8 flex flex-col gap-6 border-b border-slate-100 pb-8 sm:flex-row sm:items-center">
              <ProfileImageInput role={role} displayImageDataUrl={profile.displayImageDataUrl} initials={profile.initials} onChange={profile.changeImage} />
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-950">Profile Photo</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">This profile is shown in the {rolePortalLabel[role]} header, reports, and other account-related records.</p>
                <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide text-emerald-700 uppercase">{roleAccessLabel[role]}</span>
                {profile.displayImageFileName && <p className="mt-2 text-xs font-semibold text-emerald-700">{profile.displayImageFileName}</p>}
                {profile.displayImageDataUrl && (
                  <button
                    type="button"
                    onClick={profile.removeImage}
                    className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <AccountField
                key={`firstName-${profile.profileName.firstName}-${profile.fieldResetSignal}`}
                name="firstName"
                label="First Name"
                defaultValue={profile.profileName.firstName}
                maxLength={PERSON_NAME_MAX_LENGTH}
                editable
              />
              <AccountField
                key={`middleInitial-${profile.profileName.middleInitial}-${profile.fieldResetSignal}`}
                name="middleInitial"
                label="Middle Initial"
                defaultValue={profile.profileName.middleInitial}
                maxLength={1}
                editable
              />
              <AccountField
                key={`lastName-${profile.profileName.lastName}-${profile.fieldResetSignal}`}
                name="lastName"
                label="Last Name"
                defaultValue={profile.profileName.lastName}
                maxLength={PERSON_NAME_MAX_LENGTH}
                editable
              />
              <AccountField label="Professional Email" defaultValue={profile.user.email} type="email" />
              <AccountField label="Department" defaultValue={profile.user.department} />
              <AccountField key={`phone-${profile.user.phone}-${profile.fieldResetSignal}`} name="phone" label="Phone" defaultValue={profile.user.phone} type="tel" maxLength={18} editable />
            </div>
          </div>
        </Panel>
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="submit"
            disabled={profile.isLoading}
            className="bg-tanaw-green disabled:bg-tanaw-green/70 inline-flex min-w-44 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#044a1e]"
          >
            {profile.isLoading ? <RefreshCw size={16} className="animate-spin" /> : profile.isSuccess ? <Check size={16} /> : <Save size={16} />}
            {profile.isLoading ? "Saving..." : profile.isSuccess ? "Saved" : "Save Changes"}
          </button>
        </div>
      </form>
    </PageMotion>
  );
}
