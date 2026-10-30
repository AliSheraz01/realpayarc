import type { CSSProperties } from 'react'

/** Palm tree silhouette. Pure black so it reads against the sunset gradient. */
export function PalmTree({ className, style, flip = false }: { className?: string; style?: CSSProperties; flip?: boolean }) {
  const rightFronds = [-72, -42, -12, 22]
  return (
    <svg
      viewBox="0 0 220 320"
      className={className}
      style={{ ...style, transform: flip ? 'scaleX(-1)' : undefined }}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M98 320 C 99 236 110 150 108 78 L 117 78 C 121 152 111 238 114 320 Z" fill="#000" />
      <g transform="translate(112 76)" fill="#000">
        {rightFronds.map((angle) => (
          <path
            key={`r${angle}`}
            transform={`rotate(${angle})`}
            d="M0 0 C 26 -26 66 -30 104 -4 C 108 4 100 10 92 6 C 70 -4 40 -2 0 6 Z"
          />
        ))}
        {rightFronds.map((angle) => (
          <path
            key={`l${angle}`}
            transform={`scale(-1 1) rotate(${angle})`}
            d="M0 0 C 26 -26 66 -30 104 -4 C 108 4 100 10 92 6 C 70 -4 40 -2 0 6 Z"
          />
        ))}
        <circle cx="-6" cy="8" r="7" />
        <circle cx="6" cy="10" r="7" />
      </g>
    </svg>
  )
}

/** Fixed page backdrop: a faint sunset horizon glow with palm silhouettes, fading into black. */
export function PalmBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black" aria-hidden="true">
      <div
        className="absolute inset-x-0 bottom-0 h-[62vh] opacity-60"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(76,31,176,0.35) 28%, rgba(255,47,142,0.45) 62%, rgba(255,111,60,0.55) 85%, rgba(255,200,61,0.6) 100%)',
        }}
      />
      <PalmTree className="absolute -bottom-6 -left-10 h-[46vh] opacity-90 sm:left-4" />
      <PalmTree className="absolute -bottom-10 -right-12 h-[40vh] opacity-90 sm:right-8" flip />
      <PalmTree className="absolute -bottom-12 left-[18%] hidden h-[26vh] opacity-80 lg:block" />
      <PalmTree className="absolute -bottom-12 right-[20%] hidden h-[22vh] opacity-80 lg:block" flip />
      <div className="absolute inset-x-0 bottom-0 h-3 bg-black" />
    </div>
  )
}

/** The poster-style wordmark. */
export function Logo({ className = 'text-3xl' }: { className?: string }) {
  return (
    <span className={`logo-text inline-block ${className}`} aria-label="ArcPay">
      Arc<span className="mx-[0.12em]" />Pay
    </span>
  )
}

/** Big hero panel: gradient sky, striped sun, palms and the stacked logo. */
export function HeroArt({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative isolate overflow-hidden rounded-[1.75rem] border-[3px] border-white bg-sunset shadow-[0_0_0_3px_#000,0_18px_60px_rgba(255,47,142,0.35)]">
      <div className="absolute left-1/2 top-[44%] -z-10 h-56 w-56 -translate-x-1/2 rounded-full sm:h-72 sm:w-72"
        style={{
          background:
            'repeating-linear-gradient(180deg, #ffe27a 0 14px, #ffb23d 14px 18px), radial-gradient(circle, #ffe27a, #ff9d3d)',
          maskImage: 'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)',
          opacity: 0.85,
        }}
      />
      <PalmTree className="absolute -bottom-4 -left-6 -z-10 h-64 sm:h-80" />
      <PalmTree className="absolute -bottom-6 -right-8 -z-10 h-56 sm:h-72" flip />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-5 bg-black" />
      <div className="px-5 pb-16 pt-10 text-center sm:px-10 sm:pb-20 sm:pt-14">{children}</div>
    </div>
  )
}
