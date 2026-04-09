import type { PropsWithChildren } from 'react'

/** Корневой layout: заполняет viewport, чтобы utility-классы Tailwind применялись ко всему дереву приложения. */
export function TailwindRoot({ children }: PropsWithChildren) {
  return <div className="flex min-h-full min-h-dvh w-full flex-col">{children}</div>
}
