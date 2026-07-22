import type { CSSProperties } from "react";

const AUTH_PARTICLES = [
  { left: "7%", top: "58%", size: 3, delay: "0s", duration: "12s" },
  { left: "18%", top: "51%", size: 2, delay: "2.6s", duration: "11s" },
  { left: "23%", top: "74%", size: 3, delay: "0.4s", duration: "14s" },
  { left: "31%", top: "61%", size: 4, delay: "3.2s", duration: "12.5s" },
  { left: "44%", top: "55%", size: 3, delay: "4.1s", duration: "13s" },
  { left: "15%", top: "84%", size: 2, delay: "5.8s", duration: "16s" },
  { left: "88%", top: "78%", size: 2, delay: "7.1s", duration: "14s" },
] as const;

export function AuthParticles() {
  return (
    <div className="tanaw-stage-particles absolute inset-0" aria-hidden="true">
      {AUTH_PARTICLES.map((particle, index) => (
        <span
          key={index}
          className="tanaw-hero-particle"
          style={
            {
              left: particle.left,
              top: particle.top,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              "--particle-delay": particle.delay,
              "--particle-duration": particle.duration,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
