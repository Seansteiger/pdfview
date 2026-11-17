"use client";

import React, { useRef, useState, CSSProperties } from "react";

// ==========================================
// 1. Shimmer Button (Tactile Hardware Feel)
// ==========================================
interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ShimmerButton({
  shimmerColor = "rgba(255, 255, 255, 0.35)",
  shimmerSize = "0.08em",
  shimmerDuration = "3.5s",
  borderRadius = "100px",
  background = "#161618",
  className = "",
  children,
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      style={
        {
          "--spread": "80deg",
          "--shimmer-color": shimmerColor,
          "--radius": borderRadius,
          "--speed": shimmerDuration,
          "--cut": shimmerSize,
          "--bg": background,
        } as CSSProperties
      }
      className={`group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden [border-radius:var(--radius)] border border-white/[0.12] px-4 py-2 text-xs sm:text-sm font-medium text-white transition-[transform,opacity,background-color] duration-150 ease-out [background:var(--bg)] hover:border-white/20 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] ${className}`}
      {...props}
    >
      {/* Rotating Conic Gradient Shimmer */}
      <div className="absolute inset-0 -z-30 overflow-visible blur-[1px]">
        <div className="absolute -inset-full animate-[spin_var(--speed)_linear_infinite] [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
      </div>

      {/* Inner Masking Surface */}
      <div className="absolute inset-[var(--cut)] -z-20 [border-radius:var(--radius)] [background:var(--bg)]" />

      {/* Gloss Highlight Overlay */}
      <div className="absolute inset-0 rounded-[var(--radius)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-opacity duration-150" />

      <span className="relative z-10 flex items-center gap-1.5">{children}</span>
    </button>
  );
}

// ==========================================
// 2. Card Spotlight (Subtle Metallic Specular)
// ==========================================
interface CardSpotlightProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  spotlightColor?: string;
}

export function CardSpotlight({
  children,
  className = "",
  spotlightColor = "rgba(255, 255, 255, 0.06)",
  ...props
}: CardSpotlightProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={`relative rounded-2xl border border-white/[0.08] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] p-5 overflow-hidden transition-[transform,border-color,background-color] duration-150 ease-out active:scale-[0.99] ${className}`}
      {...props}
    >
      {/* Specular Flashlight Radial */}
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-200 z-0"
        style={{
          opacity,
          background: `radial-gradient(320px circle at ${pos.x}px ${pos.y}px, ${spotlightColor}, transparent 80%)`,
        }}
      />
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}

// ==========================================
// 3. Border Beam (Restrained Metallic Silver)
// ==========================================
export function BorderBeam({
  size = 200,
  duration = 10,
  anchor = 90,
  borderWidth = 1.25,
  colorFrom = "transparent",
  colorTo = "rgba(255, 255, 255, 0.4)",
}: {
  size?: number;
  duration?: number;
  anchor?: number;
  borderWidth?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  return (
    <div
      style={
        {
          "--size": `${size}px`,
          "--duration": `${duration}s`,
          "--anchor": `${anchor}%`,
          "--border-width": `${borderWidth}px`,
          "--color-from": colorFrom,
          "--color-to": colorTo,
        } as React.CSSProperties
      }
      className="pointer-events-none absolute inset-0 rounded-[inherit] [border:var(--border-width)_solid_transparent] ![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)] after:absolute after:aspect-square after:w-[var(--size)] after:animate-[border-beam_var(--duration)_linear_infinite] after:[animation-delay:0s] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)] after:[offset-anchor:calc(var(--anchor))_50%] after:[offset-path:rect(0_auto_auto_0_round_inherit)]"
    />
  );
}

// ==========================================
// 4. Sliding Pill Tabs (Tactile Segmented Bar)
// ==========================================
export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface SlidingPillTabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function SlidingPillTabs({
  tabs,
  activeId,
  onChange,
  className = "",
}: SlidingPillTabsProps) {
  return (
    <div
      className={`inline-flex items-center gap-1 p-1 rounded-full bg-[#111113] border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-[transform,color,background-color] duration-150 ease-out cursor-pointer active:scale-[0.98] ${
              isActive
                ? "text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {isActive && (
              <div className="absolute inset-0 rounded-full bg-white/[0.12] border border-white/15 -z-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)]" />
            )}
            {tab.icon && <span className="w-3.5 h-3.5">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] tabular-nums ${
                  isActive
                    ? "bg-white/20 text-white font-semibold"
                    : "bg-white/5 text-zinc-400"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ==========================================
// 5. Inspora Badge (Monochromatic / Status Only)
// ==========================================
export function InsporaBadge({
  children,
  variant = "default",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "accent" | "outline";
  className?: string;
}) {
  const styles = {
    default: "bg-white/[0.06] text-zinc-300 border-white/10",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-300/90 border-amber-500/20",
    accent: "bg-white/[0.10] text-zinc-100 border-white/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]",
    outline: "bg-transparent text-zinc-400 border-white/[0.08]",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border tabular-nums ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
