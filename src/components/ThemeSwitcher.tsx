import { Monitor, Moon, Sun } from 'lucide-react'

import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import type { ThemePreference } from '@/lib/theme-storage'

type ThemeSwitcherProps = {
  className?: string
}

const options: { value: ThemePreference; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Светлая тема' },
  { value: 'system', icon: Monitor, label: 'Как в системе' },
  { value: 'dark', icon: Moon, label: 'Тёмная тема' },
]

export function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Тема оформления"
      className={cn(
        'inline-flex rounded-full border border-border/70 bg-muted/60 p-1 shadow-sm backdrop-blur-md dark:border-border dark:bg-muted/50',
        className,
      )}
    >
      {options.map(({ value, icon: Icon, label }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              active
                ? 'bg-card text-foreground shadow-sm dark:bg-background dark:shadow-sm'
                : 'text-muted-foreground hover:bg-card/80 hover:text-foreground dark:hover:bg-background/60',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="sr-only">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
