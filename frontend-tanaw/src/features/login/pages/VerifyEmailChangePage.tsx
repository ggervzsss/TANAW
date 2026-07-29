import { useEffect, useLayoutEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, LoaderCircle, MailCheck, MapPin, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { AuthThemeToggle, LoginBackground } from "../components";
import { useAuthStageGlow } from "../hooks";
import { type EmailChangeVerificationResult, verifyAccountEmailChange } from "../services";
import { SAN_PEDRO_SEAL } from "../utils";

type VerificationView = "verifying" | "invalid" | "verified";

export function VerifyEmailChangePage() {
  const [token] = useState(readEmailChangeToken);
  const [view, setView] = useState<VerificationView>(token ? "verifying" : "invalid");
  const [result, setResult] = useState<EmailChangeVerificationResult | null>(null);
  const [message, setMessage] = useState(token ? "" : "This verification link is missing its security token.");
  const { stageGlowStyle, stageRef } = useAuthStageGlow<HTMLElement>();
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);

  useLayoutEffect(() => {
    if (!window.location.hash) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let isCurrent = true;
    void verifyAccountEmailChange(token)
      .then((verification) => {
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
    <section
      ref={stageRef}
      className="tanaw-login-stage tanaw-auth-stage relative min-h-svh w-full bg-(--tanaw-bg) font-['Bai_Jamjuree'] text-(--tanaw-text)"
      style={stageGlowStyle}
      data-auth-background-ready={isBackgroundReady}
    >
      <LoginBackground className="absolute inset-y-0 left-0 w-full lg:w-[82%]" onReady={() => setIsBackgroundReady(true)} />
      <div className="tanaw-login-color-grade absolute inset-0" aria-hidden="true" />
      <div className="tanaw-login-edge-blur absolute inset-0" aria-hidden="true" />
      <div className="tanaw-stage-glow absolute inset-0" aria-hidden="true" />
      <AuthThemeToggle />

      <div className="tanaw-auth-shell relative z-10 grid min-h-svh items-center gap-8 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1.04fr)_minmax(420px,0.82fr)] lg:px-12 xl:px-20">
        <section className="tanaw-auth-hero relative hidden min-h-[min(42rem,calc(100svh-2rem))] items-end px-2 pb-12 text-white lg:flex">
          <div className="relative z-10 max-w-xl">
            <ShieldCheck className="mb-5 h-9 w-9 text-(--tanaw-gold)" aria-hidden="true" />
            <h1 className="font-['Montserrat'] text-5xl leading-tight font-bold text-white drop-shadow-lg xl:text-6xl">Protect your TANAW identity</h1>
            <div className="tanaw-gold-shimmer mt-5 h-0.75 w-28 rounded-full bg-(--tanaw-gold)" />
            <p className="mt-6 max-w-lg text-lg leading-8 font-medium text-white/95">Email ownership is confirmed before TANAW IT can apply a sign-in or recovery-address change.</p>
            <div className="mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
              <MapPin className="h-5 w-5 text-white" aria-hidden="true" />
              <span>San Pedro, Laguna, Philippines</span>
            </div>
          </div>
        </section>

        <main className="flex items-center justify-center lg:justify-end">
          <section className="tanaw-auth-card w-full max-w-145 rounded-[30px] border border-white/80 bg-(--tanaw-card)/96 px-6 py-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] backdrop-blur-xl sm:px-10 sm:py-10">
            <header className="mb-8 flex items-center gap-5 border-b border-(--tanaw-gold)/60 pb-7">
              <img src={SAN_PEDRO_SEAL} alt="City of San Pedro seal" className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
              <div>
                <p className="font-['Montserrat'] text-2xl font-extrabold text-(--tanaw-green) sm:text-3xl">TANAW PORTAL</p>
                <p className="mt-1 text-sm font-semibold text-(--tanaw-muted)">Email Ownership Verification</p>
              </div>
            </header>

            {view === "verifying" ? <VerifyingState /> : null}
            {view === "invalid" ? <InvalidState message={message} /> : null}
            {view === "verified" && result ? <VerifiedState result={result} /> : null}
          </section>
        </main>
      </div>
    </section>
  );
}

function VerifyingState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center text-center" aria-live="polite">
      <LoaderCircle className="h-10 w-10 animate-spin text-(--tanaw-green)" aria-hidden="true" />
      <h2 className="mt-5 font-['Montserrat'] text-xl font-extrabold">Verifying email ownership</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 font-medium text-(--tanaw-muted)">TANAW is checking this single-use link. The address will not change until IT approves the request.</p>
    </div>
  );
}

function InvalidState({ message }: { message: string }) {
  return (
    <div className="py-4 text-center" role="alert">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertCircle className="h-7 w-7" aria-hidden="true" />
      </span>
      <h2 className="mt-5 font-['Montserrat'] text-xl font-extrabold">Verification link unavailable</h2>
      <p className="mt-3 text-sm leading-6 font-medium text-(--tanaw-muted)">{message}</p>
      <p className="mt-2 text-sm leading-6 text-(--tanaw-muted)">Request a new email change from TANAW or contact support if you did not initiate it.</p>
      <Link to={routes.login} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-(--tanaw-green) px-5 py-3 text-sm font-bold text-white">
        Return to TANAW <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function VerifiedState({ result }: { result: EmailChangeVerificationResult }) {
  return (
    <div className="py-4 text-center" aria-live="polite">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </span>
      <h2 className="mt-5 font-['Montserrat'] text-xl font-extrabold">Email ownership verified</h2>
      <p className="mt-3 text-sm leading-6 font-medium text-(--tanaw-muted)">
        Thank you, {result.displayName}. Ownership of <strong className="text-(--tanaw-text)">{result.requestedEmail}</strong> is confirmed.
      </p>
      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm leading-6 text-amber-900">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>Your current sign-in email remains active until TANAW IT reviews and approves the request. Both addresses will be notified after approval.</p>
      </div>
      <Link to={routes.login} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-(--tanaw-green) px-5 py-3 text-sm font-bold text-white">
        Return to TANAW <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function readEmailChangeToken(): string {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get("token")?.trim() ?? "";
}
