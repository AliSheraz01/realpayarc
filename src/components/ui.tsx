import { useState, type ReactNode } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function Card({ children, className = '', active = false }: { children: ReactNode; className?: string; active?: boolean }) {
  return <section className={`${active ? 'sunset-card-active' : 'sunset-card'} p-4 sm:p-5 ${className}`}>{children}</section>
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="heading-outline text-xl sm:text-2xl">{children}</h2>
      {hint ? <p className="mt-1 max-w-[60ch] text-pretty text-sm text-white/65">{hint}</p> : null}
    </div>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden="true" />
}

export function CopyButton({ value, label = 'Copy', className = '' }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`btn-ghost ${className}`}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => toast.error('Copy failed. Select the text and copy it manually.'))
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const styles = {
    info: 'border-white/20 bg-white/5 text-white/80',
    warn: 'border-sunset-yellow/60 bg-sunset-yellow/10 text-sunset-yellow',
    error: 'border-red-400/60 bg-red-500/10 text-red-300',
    ok: 'border-emerald-400/60 bg-emerald-500/10 text-emerald-300',
  }[tone]
  return <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${styles}`}>{children}</div>
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{children}</div>
    </div>
  )
}
