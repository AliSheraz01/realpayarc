import { Check } from 'lucide-react'

export interface GuideStep {
  title: string
  body: string
}

/** Vertical stepper. `current` is the step the person is on right now; earlier steps show as done. */
export function GuidedSteps({ steps, current, finished = false }: { steps: GuideStep[]; current: number; finished?: boolean }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => {
        const done = finished || index < current
        const active = !finished && index === current
        return (
          <li key={step.title} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                done
                  ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300'
                  : active
                    ? 'border-black bg-sunset text-white shadow-[0_0_0_2px_#fff]'
                    : 'border-white/20 text-white/40'
              }`}
            >
              {done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <div className={active ? '' : done ? 'opacity-80' : 'opacity-50'}>
              <div className="text-sm font-bold">{step.title}</div>
              <p className="text-pretty text-sm text-white/65">{step.body}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
