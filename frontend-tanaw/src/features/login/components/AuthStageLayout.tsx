import { type ReactNode, useState } from "react";
import { MapPin } from "lucide-react";
import { TANAW_LOGO } from "@/shared/constants/branding";
import { cn } from "@/shared/ui-kit";
import { useAuthStageGlow } from "../hooks/useAuthStageGlow";
import { AuthParticles } from "./AuthParticles";
import { AuthStageGlow } from "./AuthStageGlow";
import { AuthThemeToggle } from "./AuthThemeToggle";
import { LoginBackground } from "./LoginBackground";

type AuthStageLayoutProps = {
  /** The welcome copy that sits on the San Pedro photo (wide screens only). */
  hero: ReactNode;
  /** The panel's content: the brand header and the form or status of this screen. */
  children: ReactNode;
  /** Extra class names for the glass pane, such as `tanaw-login-card`. */
  panelClassName?: string;
  showParticles?: boolean;
};

/**
 * The sign-in and account screens: the San Pedro photo across the stage and, at the right, one
 * full-height pane of frosted glass that holds the form (auth.css). Inside the pane everything is
 * open rows and hairlines; its content fades up row by row once, when the photos are ready.
 */
export function AuthStageLayout({ hero, children, panelClassName, showParticles = false }: AuthStageLayoutProps) {
  const { cursorRef, stageRef } = useAuthStageGlow<HTMLElement>();
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);

  return (
    <section ref={stageRef} className="tanaw-login-stage tanaw-auth-stage relative min-h-svh w-full bg-(--tanaw-bg) text-(--tanaw-text)" data-auth-background-ready={isBackgroundReady}>
      <LoginBackground className="absolute inset-0 w-full" onReady={() => setIsBackgroundReady(true)} />
      <div className="tanaw-login-color-grade absolute inset-0" aria-hidden="true" />
      <div className="tanaw-login-edge-blur absolute inset-0" aria-hidden="true" />
      <AuthStageGlow cursorRef={cursorRef} />
      {showParticles ? <AuthParticles /> : null}
      <AuthThemeToggle />

      <div className="tanaw-auth-shell relative z-10">
        <section className="tanaw-auth-hero relative hidden text-white lg:flex">{hero}</section>
        <main className="tanaw-auth-main">
          <div className={cn("tanaw-auth-card", panelClassName)}>
            <div className="tanaw-auth-card__body">
              <div className="tanaw-auth-card__content tanaw-auth-rise">{children}</div>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

type AuthHeroProps = {
  icon: ReactNode;
  title: string;
  copy: string;
  titleAs?: "h1" | "h2";
};

/** White welcome copy on the photo, with a thin Seal Gold mark under the title. */
export function AuthHero({ icon, title, copy, titleAs: Title = "h2" }: AuthHeroProps) {
  return (
    <div className="tanaw-auth-hero__inner">
      <div className="tanaw-auth-hero__icon">{icon}</div>
      <Title className="tanaw-auth-hero-title">{title}</Title>
      <span className="tanaw-auth-hero__mark" aria-hidden="true" />
      <p className="tanaw-auth-hero-copy">{copy}</p>
      <p className="tanaw-auth-hero-location">
        <MapPin className="h-4 w-4 flex-none" strokeWidth={2} aria-hidden="true" />
        <span>San Pedro, Laguna, Philippines</span>
      </p>
    </div>
  );
}

type AuthBrandHeaderProps = {
  subtitle: string;
  /** The page heading is `h1`; use `p` where the photo side already carries the page's `h1`. */
  titleAs?: "h1" | "p";
};

/** The TANAW logo, the portal name with the civic line under it, and what this screen is for. */
export function AuthBrandHeader({ subtitle, titleAs: Title = "h1" }: AuthBrandHeaderProps) {
  return (
    <header className="tanaw-auth-card-header">
      <img src={TANAW_LOGO} alt="" className="tanaw-auth-brand-logo" />
      <div className="min-w-0">
        <Title className="tanaw-auth-brand-title">TANAW PORTAL</Title>
        <p className="tanaw-auth-brand-subtitle">{subtitle}</p>
        <span className="tanaw-civic-line tanaw-auth-civic-line" aria-hidden="true" />
      </div>
    </header>
  );
}
