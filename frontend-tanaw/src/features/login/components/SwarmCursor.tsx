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

const MAX_PARTICLES = 120;
const MAX_QUADS = 6000;
const HISTORY_LENGTH = 120;
const FORM_RADIUS_MULTIPLIER = 2.1;

function buildPermutation() {
  const source = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) source[index] = index;
  for (let index = 255; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const value = source[index];
    source[index] = source[swapIndex];
    source[swapIndex] = value;
  }
  const permutation = new Uint16Array(512);
  for (let index = 0; index < 512; index += 1) permutation[index] = source[index & 255];
  return permutation;
}

const smoothFade = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);

function gradientDot(hash: number, x: number, y: number, z: number) {
  const first = hash < 8 ? x : y;
  const second = hash < 4 ? y : hash === 12 || hash === 14 ? x : z;
  return ((hash & 1) === 0 ? first : -first) + ((hash & 2) === 0 ? second : -second);
}

function noise3(permutation: Uint16Array, x: number, y: number, z: number) {
  const floorX = Math.floor(x);
  const floorY = Math.floor(y);
  const floorZ = Math.floor(z);
  const gridX = floorX & 255;
  const gridY = floorY & 255;
  const gridZ = floorZ & 255;
  const relativeX = x - floorX;
  const relativeY = y - floorY;
  const relativeZ = z - floorZ;
  const fadeX = smoothFade(relativeX);
  const fadeY = smoothFade(relativeY);
  const fadeZ = smoothFade(relativeZ);
  const first = permutation[gridX] + gridY;
  const firstFirst = permutation[first & 511] + gridZ;
  const firstSecond = permutation[(first + 1) & 511] + gridZ;
  const second = permutation[(gridX + 1) & 511] + gridY;
  const secondFirst = permutation[second & 511] + gridZ;
  const secondSecond = permutation[(second + 1) & 511] + gridZ;
  const gradient000 = gradientDot(permutation[firstFirst & 511] & 15, relativeX, relativeY, relativeZ);
  const gradient100 = gradientDot(permutation[secondFirst & 511] & 15, relativeX - 1, relativeY, relativeZ);
  const gradient010 = gradientDot(permutation[firstSecond & 511] & 15, relativeX, relativeY - 1, relativeZ);
  const gradient110 = gradientDot(permutation[secondSecond & 511] & 15, relativeX - 1, relativeY - 1, relativeZ);
  const gradient001 = gradientDot(permutation[(firstFirst + 1) & 511] & 15, relativeX, relativeY, relativeZ - 1);
  const gradient101 = gradientDot(permutation[(secondFirst + 1) & 511] & 15, relativeX - 1, relativeY, relativeZ - 1);
  const gradient011 = gradientDot(permutation[(firstSecond + 1) & 511] & 15, relativeX, relativeY - 1, relativeZ - 1);
  const gradient111 = gradientDot(permutation[(secondSecond + 1) & 511] & 15, relativeX - 1, relativeY - 1, relativeZ - 1);
  const interpolated00 = gradient000 + fadeX * (gradient100 - gradient000);
  const interpolated10 = gradient010 + fadeX * (gradient110 - gradient010);
  const interpolated01 = gradient001 + fadeX * (gradient101 - gradient001);
  const interpolated11 = gradient011 + fadeX * (gradient111 - gradient011);
  const interpolated0 = interpolated00 + fadeY * (interpolated10 - interpolated00);
  const interpolated1 = interpolated01 + fadeY * (interpolated11 - interpolated01);
  return interpolated0 + fadeZ * (interpolated1 - interpolated0);
}

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
  accentColor = "#ffffff",
  color = "#ffffff",
  count = 10,
  enabled = true,
  glow = 0.75,
  merge = 0.77,
  opacity = 1,
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
      const activeRenderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio || 1, 1.75) });
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

      const permutation = buildPermutation();
      const x = new Float32Array(MAX_PARTICLES);
      const y = new Float32Array(MAX_PARTICLES);
      const velocityX = new Float32Array(MAX_PARTICLES);
      const velocityY = new Float32Array(MAX_PARTICLES);
      const scale = new Float32Array(MAX_PARTICLES);
      const agility = new Float32Array(MAX_PARTICLES);
      const handedness = new Float32Array(MAX_PARTICLES);
      const noiseX = new Float32Array(MAX_PARTICLES);
      const noiseY = new Float32Array(MAX_PARTICLES);
      const historyX = new Float32Array(HISTORY_LENGTH * MAX_PARTICLES);
      const historyY = new Float32Array(HISTORY_LENGTH * MAX_PARTICLES);
      const historyTime = new Float32Array(HISTORY_LENGTH);
      let historyHead = 0;
      let historyLength = 0;
      let lastHistorySample = -1;
      const spawn = (particle: number, originX: number, originY: number) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 120;
        x[particle] = originX + Math.cos(angle) * radius;
        y[particle] = originY + Math.sin(angle) * radius;
        velocityX[particle] = Math.cos(angle) * 60;
        velocityY[particle] = Math.sin(angle) * 60;
        for (let history = 0; history < HISTORY_LENGTH; history += 1) {
          historyX[history * MAX_PARTICLES + particle] = x[particle];
          historyY[history * MAX_PARTICLES + particle] = y[particle];
        }
      };
      for (let particle = 0; particle < MAX_PARTICLES; particle += 1) {
        spawn(particle, width / 2, height / 2);
        scale[particle] = 0.65 + Math.random() * 0.6;
        agility[particle] = 0.75 + Math.random() * 0.5;
        handedness[particle] = Math.random() < 0.5 ? -1 : 1;
        noiseX[particle] = Math.random() * 260;
        noiseY[particle] = Math.random() * 260;
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
        const escapeSpeed = 620 + settingsRef.current.speed * 130;
        for (let particle = 0; particle < MAX_PARTICLES; particle += 1) {
          let deltaX = x[particle] - cursor.x;
          let deltaY = y[particle] - cursor.y;
          let distance = Math.hypot(deltaX, deltaY);
          if (distance < 0.001) {
            const angle = Math.random() * Math.PI * 2;
            deltaX = Math.cos(angle);
            deltaY = Math.sin(angle);
            distance = 1;
          }
          const kick = escapeSpeed * (0.75 + Math.random() * 0.5);
          velocityX[particle] = (deltaX / distance) * kick;
          velocityY[particle] = (deltaY / distance) * kick;
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
        const delta = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        const particleCount = clampCount(settings.count);
        const anchorX = cursor.active ? cursor.x : width / 2;
        const anchorY = cursor.active ? cursor.y : height / 2;
        for (let particle = activeCount; particle < particleCount; particle += 1) spawn(particle, anchorX, anchorY);
        activeCount = particleCount;
        burst = Math.max(0, burst - delta / 0.5);
        const maximumSpeed = 110 + Math.max(0.1, settings.speed) * 165;
        const steerRate = 4.5 + Math.max(0.1, settings.speed) * 1.15;
        const maximumForce = maximumSpeed * 9;
        const orbitRadius = Math.max(20, settings.spread * 0.55);
        const separationDistance = Math.max(1, settings.spread * 0.42 * (0.35 + settings.separation));
        const flowMix = settings.wander * 2.4;
        const epsilon = 0.08;
        const baseScale = 0.0016;
        const fineScale = baseScale * 3.6;
        const time = now * 0.001;

        for (let particle = 0; particle < particleCount; particle += 1) {
          const deltaX = anchorX - x[particle];
          const deltaY = anchorY - y[particle];
          const distance = Math.max(0.01, Math.hypot(deltaX, deltaY));
          const normalX = deltaX / distance;
          const normalY = deltaY / distance;
          const orbitDrift = noise3(permutation, noiseX[particle], noiseY[particle], time * 0.13);
          const localOrbit = orbitRadius * (0.34 + 1.35 * clamp(orbitDrift + 0.5, 0, 1));
          const radial = clamp((distance - localOrbit) / (orbitRadius * 0.85), -1, 1);
          const swirl = Math.sqrt(Math.max(0, 1 - radial * radial)) * handedness[particle];
          let desiredX = normalX * radial - normalY * swirl;
          let desiredY = normalY * radial + normalX * swirl;

          if (flowMix > 0.001) {
            const baseX = x[particle] * baseScale;
            const baseY = y[particle] * baseScale;
            const baseTime = time * 0.22;
            const coarseX = (noise3(permutation, baseX, baseY + epsilon, baseTime) - noise3(permutation, baseX, baseY - epsilon, baseTime)) / (2 * epsilon);
            const coarseY = -(noise3(permutation, baseX + epsilon, baseY, baseTime) - noise3(permutation, baseX - epsilon, baseY, baseTime)) / (2 * epsilon);
            const detailX = x[particle] * fineScale + noiseX[particle];
            const detailY = y[particle] * fineScale + noiseY[particle];
            const detailTime = time * 0.55;
            const fineX = (noise3(permutation, detailX, detailY + epsilon, detailTime) - noise3(permutation, detailX, detailY - epsilon, detailTime)) / (2 * epsilon);
            const fineY = -(noise3(permutation, detailX + epsilon, detailY, detailTime) - noise3(permutation, detailX - epsilon, detailY, detailTime)) / (2 * epsilon);
            desiredX += (coarseX + fineX * 0.7) * flowMix;
            desiredY += (coarseY + fineY * 0.7) * flowMix;
          }

          const desiredLength = Math.max(0.01, Math.hypot(desiredX, desiredY));
          desiredX /= desiredLength;
          desiredY /= desiredLength;
          const localSteerRate = steerRate * agility[particle] * (1 - burst);
          let accelerationX = (desiredX * maximumSpeed - velocityX[particle]) * localSteerRate;
          let accelerationY = (desiredY * maximumSpeed - velocityY[particle]) * localSteerRate;
          if (burst > 0.001) {
            accelerationX -= normalX * maximumSpeed * burst * 5.5;
            accelerationY -= normalY * maximumSpeed * burst * 5.5;
          }
          for (let neighbor = 0; neighbor < particleCount; neighbor += 1) {
            if (neighbor === particle) continue;
            const apartX = x[particle] - x[neighbor];
            const apartY = y[particle] - y[neighbor];
            const apart = Math.hypot(apartX, apartY);
            if (apart > 0 && apart < separationDistance) {
              const force = (1 - apart / separationDistance) * maximumSpeed * 3.2 * settings.separation;
              accelerationX += (apartX / apart) * force;
              accelerationY += (apartY / apart) * force;
            }
          }

          const accelerationLength = Math.hypot(accelerationX, accelerationY);
          const accelerationLimit = maximumForce * (1 + burst * 4);
          if (accelerationLength > accelerationLimit) {
            accelerationX = (accelerationX / accelerationLength) * accelerationLimit;
            accelerationY = (accelerationY / accelerationLength) * accelerationLimit;
          }

          velocityX[particle] += accelerationX * delta;
          velocityY[particle] += accelerationY * delta;
          const currentSpeed = Math.max(0.01, Math.hypot(velocityX[particle], velocityY[particle]));
          const highSpeed = maximumSpeed * (1 + burst * 3.5);
          const lowSpeed = maximumSpeed * 0.32;
          if (currentSpeed > highSpeed) {
            velocityX[particle] = (velocityX[particle] / currentSpeed) * highSpeed;
            velocityY[particle] = (velocityY[particle] / currentSpeed) * highSpeed;
          } else if (currentSpeed < lowSpeed) {
            velocityX[particle] = (velocityX[particle] / currentSpeed) * lowSpeed;
            velocityY[particle] = (velocityY[particle] / currentSpeed) * lowSpeed;
          }
          x[particle] += velocityX[particle] * delta;
          y[particle] += velocityY[particle] * delta;
        }

        const nowSeconds = now * 0.001;
        if (lastHistorySample < 0 || nowSeconds - lastHistorySample >= 0.008) {
          lastHistorySample = nowSeconds;
          historyTime[historyHead] = nowSeconds;
          const historyOffset = historyHead * MAX_PARTICLES;
          for (let particle = 0; particle < particleCount; particle += 1) {
            historyX[historyOffset + particle] = x[particle];
            historyY[historyOffset + particle] = y[particle];
          }
          historyHead = (historyHead + 1) % HISTORY_LENGTH;
          historyLength = Math.min(HISTORY_LENGTH, historyLength + 1);
        }

        let quadCount = 0;
        const pushQuad = (centerX: number, centerY: number, radius: number, weight: number) => {
          if (quadCount >= MAX_QUADS) return;
          const positionOffset = quadCount * 8;
          positions.set([centerX - radius, centerY - radius, centerX + radius, centerY - radius, centerX + radius, centerY + radius, centerX - radius, centerY + radius], positionOffset);
          weights.fill(weight, quadCount * 4, quadCount * 4 + 4);
          quadCount += 1;
        };
        const trailAge = settings.trail * 0.85;
        const perAgent = Math.max(0, Math.floor(MAX_QUADS / particleCount) - 1);
        const maxStamps = Math.min(46, perAgent);
        for (let particle = 0; particle < particleCount; particle += 1) {
          const headRadius = settings.size * scale[particle] * FORM_RADIUS_MULTIPLIER;
          const headWeight = 1.06 + 0.3 * scale[particle];
          pushQuad(x[particle], y[particle], headRadius, headWeight);
          if (trailAge < 0.01 || maxStamps < 2 || historyLength < 2) continue;

          const step = Math.max(2, settings.size * scale[particle] * 0.5);
          const span = step * maxStamps;
          let previousX = x[particle];
          let previousY = y[particle];
          let walked = 0;
          let nextStampAt = step;
          let stamps = 0;

          for (let sample = 0; sample < historyLength && stamps < maxStamps; sample += 1) {
            const slot = (historyHead - 1 - sample + HISTORY_LENGTH) % HISTORY_LENGTH;
            if (nowSeconds - historyTime[slot] > trailAge) break;
            const historyPointX = historyX[slot * MAX_PARTICLES + particle];
            const historyPointY = historyY[slot * MAX_PARTICLES + particle];
            const segmentX = historyPointX - previousX;
            const segmentY = historyPointY - previousY;
            const segmentLength = Math.hypot(segmentX, segmentY);
            if (segmentLength < 0.0001) continue;

            while (nextStampAt <= walked + segmentLength && stamps < maxStamps) {
              const segmentProgress = (nextStampAt - walked) / segmentLength;
              const trailProgress = nextStampAt / span;
              const taper = Math.pow(Math.max(0, 1 - trailProgress), 0.55);
              const stampRadius = headRadius * taper;
              if (stampRadius < step) {
                stamps = maxStamps;
                break;
              }
              const stampWeight = Math.min(headWeight, (headWeight * step) / (stampRadius * 0.934));
              pushQuad(previousX + segmentX * segmentProgress, previousY + segmentY * segmentProgress, stampRadius, stampWeight);
              stamps += 1;
              nextStampAt += step;
            }
            walked += segmentLength;
            previousX = historyPointX;
            previousY = historyPointY;
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

  return (
    <div
      ref={containerRef}
      className={`swarm-cursor ${className}`.trim()}
      data-swarm-cursor="true"
      data-swarm-visual="firefly"
      data-swarm-algorithm="reactbits-noise-field"
      data-swarm-count={count}
      data-swarm-size={size}
      data-swarm-radius-scale={FORM_RADIUS_MULTIPLIER}
      data-swarm-speed={speed}
      data-swarm-trail={trail}
      aria-hidden="true"
      {...rest}
    />
  );
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
