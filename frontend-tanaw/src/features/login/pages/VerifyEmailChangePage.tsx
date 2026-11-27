import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, MailCheck, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Skeleton } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { AuthBrandHeader, AuthHero, AuthStageLayout } from "../components";
import { type EmailChangeVerificationResult, verifyAccountEmailChange } from "../services";

type VerificationView = "verifying" | "invalid" | "verified";

export function VerifyEmailChangePage() {
  const [token] = useState(readEmailChangeToken);
  const [view, setView] = useState<VerificationView>(token ? "verifying" : "invalid");
  const [result, setResult] = useState<EmailChangeVerificationResult | null>(null);
  const [message, setMessage] = useState(token ? "" : "This verification link is missing its security token.");

  useEffect(() => {
    if (!token) return undefined;
    let isCurrent = true;
    void verifyAccountEmailChange(token)
      .then((verification) => {
        clearEmailChangeTokenFromAddressBar();
        if (!isCurrent) return;
        setResult(verification);
        setView("verified");
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setMessage(getApiErrorMessage(error, "This email verification link is invalid, expired, or has already been used."));
        setView("invalid");
      });
    return () => {
      isCurrent = false;
    };
  }, [token]);

  return (
    <AuthStageLayout
      hero={
        <AuthHero
          titleAs="h1"
          icon={<ShieldCheck className="h-8 w-8" aria-hidden="true" />}
          title="Protect your TANAW identity"
          copy="Email ownership is confirmed before TANAW IT can apply a sign-in or recovery-address change."
        />
      }
    >
      <AuthBrandHeader titleAs="p" subtitle="Email Ownership Verification" />
      {view === "verifying" ? <VerifyingState /> : null}
      {view === "invalid" ? <InvalidState message={message} /> : null}
      {view === "verified" && result ? <VerifiedState result={result} /> : null}
    </AuthStageLayout>
  );
}

function VerifyingState() {
  return (
    <div className="tanaw-auth-state" aria-live="polite" aria-busy="true">
      <h2 className="tanaw-auth-state__title">Verifying email ownership</h2>
      <p className="tanaw-auth-state__copy">TANAW is checking this single-use link. The address will not change until IT approves the request.</p>
      <div className="tanaw-auth-state__skeleton" aria-hidden="true">
        <Skeleton className="block h-4 w-3/4" />
        <Skeleton className="block h-4 w-1/2" />
        <Skeleton className="mt-3 block h-12 w-44" />
      </div>
    </div>
  );
}

function InvalidState({ message }: { message: string }) {
  return (
    <div className="tanaw-auth-state" role="alert">
      <span className="tanaw-auth-state__mark tanaw-auth-state__mark--danger">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="tanaw-auth-state__title">Verification link unavailable</h2>
      <p className="tanaw-auth-state__copy">{message}</p>
      <p className="tanaw-auth-state__copy">Request a new email change from TANAW or contact support if you did not initiate it.</p>
      <Link to={routes.login} className="tanaw-auth-button tanaw-auth-sheen mt-6">
        Return to TANAW <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function VerifiedState({ result }: { result: EmailChangeVerificationResult }) {
  return (
    <div className="tanaw-auth-state" aria-live="polite">
      <span className="tanaw-auth-state__mark tanaw-auth-state__mark--success">
        <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="tanaw-auth-state__title">Email ownership verified</h2>
      <p className="tanaw-auth-state__copy">
        Thank you, {result.displayName}. Ownership of <strong className="font-semibold text-(--tanaw-text)">{result.requestedEmail}</strong> is confirmed.
      </p>
      <div className="tanaw-auth-note tanaw-auth-note--warning tanaw-auth-note--ruled mt-6">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>Your current sign-in email remains active until TANAW IT reviews and approves the request. Both addresses will be notified after approval.</p>
      </div>
      <Link to={routes.login} className="tanaw-auth-button tanaw-auth-sheen mt-6">
        Return to TANAW <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function readEmailChangeToken(): string {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get("token")?.trim() ?? "";
}

function clearEmailChangeTokenFromAddressBar() {
  if (!window.location.hash) return;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
}
