import { useEffect, useRef, type HTMLAttributes } from "react";
import { Geometry, Mesh, Program, Renderer, RenderTarget, Triangle } from "ogl";
import "./SwarmCursor.css";

const FIELD_VERTEX = `
precision highp float;
attribute vec2 position;
attribute vec2 aLocal;
attribute float aWeight;
uniform vec2 uResolution;
varying vec2 vLocal;
varying float vWeight;
void main() {
  vLocal = aLocal;
  vWeight = aWeight;
  vec2 clip = (position / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FIELD_FRAGMENT = `
precision highp float;
varying vec2 vLocal;
varying float vWeight;
void main() {
  float distanceFromCenter = length(vLocal);
  float alpha = exp(-distanceFromCenter * distanceFromCenter * 3.6) * vWeight;
  gl_FragColor = vec4(alpha);
}`;

const COMPOSITE_VERTEX = `
precision highp float;
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const COMPOSITE_FRAGMENT = `
precision highp float;
uniform sampler2D tField;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uMerge;
uniform float uGlow;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float field = texture2D(tField, vUv).r;
  float edge = uMerge * 0.3;
  float core = smoothstep(uMerge - edge, uMerge + edge, field);
  float halo = smoothstep(uMerge * 0.12, uMerge, field);
  vec3 color = mix(uColor, uAccent, clamp(field / max(uMerge * 2.4, 0.001), 0.0, 1.0));
  float alpha = (core + halo * uGlow * (1.0 - core)) * uOpacity;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}`;

const MAX_PARTICLES = 60;
const MAX_QUADS = 3600;
const HISTORY_LENGTH = 72;

type SwarmSettings = Required<
  Pick<SwarmCursorProps, "accentColor" | "color" | "count" | "enabled" | "glow" | "merge" | "opacity" | "scatterOnClick" | "separation" | "size" | "speed" | "spread" | "trail" | "wander">
>;

export type SwarmCursorProps = Omit<HTMLAttributes<HTMLDivElement>, "color"> & {
  accentColor?: string;
  color?: string;
  count?: number;
  enabled?: boolean;
  glow?: number;
  merge?: number;
  opacity?: number;
  scatterOnClick?: boolean;
  separation?: number;
  size?: number;
  speed?: number;
  spread?: number;
  trail?: number;
  wander?: number;
};

export function SwarmCursor({
  accentColor = "#d7b35a",
  color = "#f8fafc",
  count = 10,
  enabled = true,
  glow = 0.75,
  merge = 0.77,
  opacity = 0.82,
  scatterOnClick = true,
  separation = 0.15,
  size = 10,
  speed = 2.5,
  spread = 100,
  trail = 0.75,
  wander = 0.25,
  className = "",
  ...rest
}: SwarmCursorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<SwarmSettings>({ accentColor, color, count, enabled, glow, merge, opacity, scatterOnClick, separation, size, speed, spread, trail, wander });

  useEffect(() => {
    settingsRef.current = { accentColor, color, count, enabled, glow, merge, opacity, scatterOnClick, separation, size, speed, spread, trail, wander };
  }, [accentColor, color, count, enabled, glow, merge, opacity, scatterOnClick, separation, size, speed, spread, trail, wander]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !settingsRef.current.enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let renderer: Renderer | undefined;
    try {
      const activeRenderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio || 1, 1.5) });
      renderer = activeRenderer;
      const gl = activeRenderer.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.canvas.className = "swarm-cursor__canvas";
      gl.canvas.setAttribute("aria-hidden", "true");
      container.appendChild(gl.canvas);
      container.dataset.swarmState = "active";

      const positions = new Float32Array(MAX_QUADS * 8);
      const localCoordinates = new Float32Array(MAX_QUADS * 8);
      const weights = new Float32Array(MAX_QUADS * 4);
      const indices = new Uint16Array(MAX_QUADS * 6);
      for (let index = 0; index < MAX_QUADS; index += 1) {
        const vertex = index * 4;
        localCoordinates.set([-1, -1, 1, -1, 1, 1, -1, 1], vertex * 2);
        indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], index * 6);
      }

      const geometry = new Geometry(gl, {
        position: { size: 2, data: positions, usage: gl.DYNAMIC_DRAW },
        aLocal: { size: 2, data: localCoordinates },
        aWeight: { size: 1, data: weights, usage: gl.DYNAMIC_DRAW },
        index: { data: indices },
      });
      const fieldProgram = new Program(gl, {
        vertex: FIELD_VERTEX,
        fragment: FIELD_FRAGMENT,
        uniforms: { uResolution: { value: [1, 1] } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        cullFace: false,
      });
      fieldProgram.setBlendFunc(gl.ONE, gl.ONE);
      const fieldMesh = new Mesh(gl, { geometry, program: fieldProgram });
      const compositeProgram = new Program(gl, {
        vertex: COMPOSITE_VERTEX,
        fragment: COMPOSITE_FRAGMENT,
        uniforms: {
          tField: { value: null },
          uColor: { value: hexToRgb(settingsRef.current.color) },
          uAccent: { value: hexToRgb(settingsRef.current.accentColor) },
          uMerge: { value: settingsRef.current.merge },
          uGlow: { value: settingsRef.current.glow },
          uOpacity: { value: settingsRef.current.opacity },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        cullFace: false,
      });
      const screenGeometry = new Triangle(gl);
      const compositeMesh = new Mesh(gl, { geometry: screenGeometry, program: compositeProgram });
      const renderTarget = new RenderTarget(gl, { width: 1, height: 1, depth: false });

      let width = 1;
      let height = 1;
      const resize = () => {
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        activeRenderer.setSize(width, height);
        fieldProgram.uniforms.uResolution.value = [width, height];
        renderTarget.setSize(Math.max(1, gl.drawingBufferWidth), Math.max(1, gl.drawingBufferHeight));
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();

      const x = new Float32Array(MAX_PARTICLES);
      const y = new Float32Array(MAX_PARTICLES);
      const velocityX = new Float32Array(MAX_PARTICLES);
      const velocityY = new Float32Array(MAX_PARTICLES);
      const scale = new Float32Array(MAX_PARTICLES);
      const phase = new Float32Array(MAX_PARTICLES);
      const historyX = new Float32Array(HISTORY_LENGTH * MAX_PARTICLES);
      const historyY = new Float32Array(HISTORY_LENGTH * MAX_PARTICLES);
      let historyHead = 0;
      let historyLength = 0;
      const spawn = (particle: number, originX: number, originY: number) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 32 + Math.random() * 100;
        x[particle] = originX + Math.cos(angle) * radius;
        y[particle] = originY + Math.sin(angle) * radius;
        velocityX[particle] = Math.cos(angle) * 45;
        velocityY[particle] = Math.sin(angle) * 45;
        for (let history = 0; history < HISTORY_LENGTH; history += 1) {
          historyX[history * MAX_PARTICLES + particle] = x[particle];
          historyY[history * MAX_PARTICLES + particle] = y[particle];
        }
      };
      for (let particle = 0; particle < MAX_PARTICLES; particle += 1) {
        spawn(particle, width / 2, height / 2);
        scale[particle] = 0.65 + Math.random() * 0.6;
        phase[particle] = Math.random() * Math.PI * 2;
      }

      const cursor = { x: width / 2, y: height / 2, active: false };
      let activeCount = clampCount(settingsRef.current.count);
      let burst = 0;
      const updateCursor = (event: globalThis.PointerEvent) => {
        if (event.pointerType === "touch") return;
        const bounds = container.getBoundingClientRect();
        cursor.x = event.clientX - bounds.left;
        cursor.y = event.clientY - bounds.top;
        cursor.active = true;
      };
      const clearCursor = () => {
        cursor.active = false;
      };
      const scatter = (event: globalThis.PointerEvent) => {
        if (event.pointerType === "touch") return;
        if (!settingsRef.current.scatterOnClick || !settingsRef.current.enabled) return;
        updateCursor(event);
        const impulse = 560 + settingsRef.current.speed * 120;
        for (let particle = 0; particle < activeCount; particle += 1) {
          const deltaX = x[particle] - cursor.x;
          const deltaY = y[particle] - cursor.y;
          const distance = Math.max(1, Math.hypot(deltaX, deltaY));
          velocityX[particle] = (deltaX / distance) * impulse;
          velocityY[particle] = (deltaY / distance) * impulse;
        }
        burst = 1;
        container.dataset.swarmInteraction = "scatter";
      };
      window.addEventListener("pointermove", updateCursor, { capture: true, passive: true });
      window.addEventListener("pointerdown", scatter, { capture: true, passive: true });
      window.addEventListener("blur", clearCursor);

      let animationFrame = 0;
      let lastTime = performance.now();
      const drawFrame = (now: number) => {
        animationFrame = requestAnimationFrame(drawFrame);
        if (document.hidden || !settingsRef.current.enabled) {
          lastTime = now;
          return;
        }
        const settings = settingsRef.current;
        const delta = Math.min((now - lastTime) / 1000, 0.04);
        lastTime = now;
        const particleCount = clampCount(settings.count);
        const anchorX = cursor.active ? cursor.x : width / 2;
        const anchorY = cursor.active ? cursor.y : height / 2;
        for (let particle = activeCount; particle < particleCount; particle += 1) spawn(particle, anchorX, anchorY);
        activeCount = particleCount;
        burst = Math.max(0, burst - delta / 0.55);
        const maximumSpeed = 95 + Math.max(0.1, settings.speed) * 120;
        const orbitRadius = Math.max(20, settings.spread * 0.55);
        const separationDistance = Math.max(10, settings.spread * (0.2 + settings.separation));
        const time = now * 0.001;

        for (let particle = 0; particle < particleCount; particle += 1) {
          const deltaX = anchorX - x[particle];
          const deltaY = anchorY - y[particle];
          const distance = Math.max(0.01, Math.hypot(deltaX, deltaY));
          const normalX = deltaX / distance;
          const normalY = deltaY / distance;
          const radial = clamp((distance - orbitRadius) / orbitRadius, -1, 1);
          const direction = particle % 2 === 0 ? 1 : -1;
          const drift = settings.wander * Math.sin(time * (0.8 + scale[particle] * 0.2) + phase[particle]);
          let desiredX = normalX * radial - normalY * (direction * 0.7 + drift);
          let desiredY = normalY * radial + normalX * (direction * 0.7 + drift);
          const desiredLength = Math.max(0.01, Math.hypot(desiredX, desiredY));
          desiredX /= desiredLength;
          desiredY /= desiredLength;
          let accelerationX = (desiredX * maximumSpeed - velocityX[particle]) * (5 + settings.speed);
          let accelerationY = (desiredY * maximumSpeed - velocityY[particle]) * (5 + settings.speed);
          for (let neighbor = 0; neighbor < particleCount; neighbor += 1) {
            if (neighbor === particle) continue;
            const apartX = x[particle] - x[neighbor];
            const apartY = y[particle] - y[neighbor];
            const apart = Math.hypot(apartX, apartY);
            if (apart > 0 && apart < separationDistance) {
              const force = (1 - apart / separationDistance) * maximumSpeed * settings.separation * 3;
              accelerationX += (apartX / apart) * force;
              accelerationY += (apartY / apart) * force;
            }
          }
          if (burst > 0) {
            accelerationX -= normalX * maximumSpeed * burst * 5;
            accelerationY -= normalY * maximumSpeed * burst * 5;
          }
          velocityX[particle] += accelerationX * delta;
          velocityY[particle] += accelerationY * delta;
          const currentSpeed = Math.max(0.01, Math.hypot(velocityX[particle], velocityY[particle]));
          const speedLimit = maximumSpeed * (1 + burst * 3);
          if (currentSpeed > speedLimit) {
            velocityX[particle] = (velocityX[particle] / currentSpeed) * speedLimit;
            velocityY[particle] = (velocityY[particle] / currentSpeed) * speedLimit;
          }
          x[particle] += velocityX[particle] * delta;
          y[particle] += velocityY[particle] * delta;
        }

        const historyOffset = historyHead * MAX_PARTICLES;
        for (let particle = 0; particle < particleCount; particle += 1) {
          historyX[historyOffset + particle] = x[particle];
          historyY[historyOffset + particle] = y[particle];
        }
        historyHead = (historyHead + 1) % HISTORY_LENGTH;
        historyLength = Math.min(HISTORY_LENGTH, historyLength + 1);

        let quadCount = 0;
        const pushQuad = (centerX: number, centerY: number, radius: number, weight: number) => {
          if (quadCount >= MAX_QUADS) return;
          const positionOffset = quadCount * 8;
          positions.set([centerX - radius, centerY - radius, centerX + radius, centerY - radius, centerX + radius, centerY + radius, centerX - radius, centerY + radius], positionOffset);
          weights.fill(weight, quadCount * 4, quadCount * 4 + 4);
          quadCount += 1;
        };
        const trailSamples = Math.min(historyLength, Math.round(settings.trail * 38));
        for (let particle = 0; particle < particleCount; particle += 1) {
          const headRadius = settings.size * scale[particle] * 2.05;
          pushQuad(x[particle], y[particle], headRadius, 1.05 + scale[particle] * 0.25);
          for (let sample = 2; sample < trailSamples; sample += 2) {
            const slot = (historyHead - 1 - sample + HISTORY_LENGTH) % HISTORY_LENGTH;
            const taper = Math.pow(1 - sample / Math.max(1, trailSamples), 0.65);
            pushQuad(historyX[slot * MAX_PARTICLES + particle], historyY[slot * MAX_PARTICLES + particle], headRadius * taper, taper * 0.48);
          }
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.aWeight.needsUpdate = true;
        geometry.setDrawRange(0, quadCount * 6);
        compositeProgram.uniforms.uColor.value = hexToRgb(settings.color);
        compositeProgram.uniforms.uAccent.value = hexToRgb(settings.accentColor);
        compositeProgram.uniforms.uMerge.value = settings.merge;
        compositeProgram.uniforms.uGlow.value = settings.glow;
        compositeProgram.uniforms.uOpacity.value = settings.opacity;
        activeRenderer.render({ scene: fieldMesh, target: renderTarget, clear: true });
        compositeProgram.uniforms.tField.value = renderTarget.texture;
        activeRenderer.render({ scene: compositeMesh, clear: true });
      };
      animationFrame = requestAnimationFrame(drawFrame);

      return () => {
        cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        window.removeEventListener("pointermove", updateCursor, { capture: true });
        window.removeEventListener("pointerdown", scatter, { capture: true });
        window.removeEventListener("blur", clearCursor);
        geometry.remove();
        screenGeometry.remove();
        fieldProgram.remove();
        compositeProgram.remove();
        if (gl.canvas.parentElement === container) container.removeChild(gl.canvas);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        delete container.dataset.swarmState;
        delete container.dataset.swarmInteraction;
      };
    } catch {
      const gl = renderer?.gl;
      if (gl?.canvas.parentElement === container) container.removeChild(gl.canvas);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      container.dataset.swarmState = "unavailable";
      return undefined;
    }
  }, []);

  return <div ref={containerRef} className={`swarm-cursor ${className}`.trim()} data-swarm-cursor="true" aria-hidden="true" {...rest} />;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampCount(value: number) {
  return Math.max(1, Math.min(MAX_PARTICLES, Math.round(value)));
}

function hexToRgb(hex: string) {
  let normalized = hex.replace("#", "").trim();
  if (normalized.length === 3)
    normalized = normalized
      .split("")
      .map((character) => character + character)
      .join("");
  const value = Number.parseInt(normalized || "000000", 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
