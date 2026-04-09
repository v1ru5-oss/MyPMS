import type { ComponentType } from 'react'
import { Globe } from 'lucide-react'

import { citizenshipIsoCode } from '@/lib/citizenship-flag'
import { cn } from '@/lib/utils'

import AE from 'country-flag-icons/react/3x2/AE'
import AM from 'country-flag-icons/react/3x2/AM'
import AU from 'country-flag-icons/react/3x2/AU'
import AZ from 'country-flag-icons/react/3x2/AZ'
import BY from 'country-flag-icons/react/3x2/BY'
import CA from 'country-flag-icons/react/3x2/CA'
import CN from 'country-flag-icons/react/3x2/CN'
import DE from 'country-flag-icons/react/3x2/DE'
import EE from 'country-flag-icons/react/3x2/EE'
import EG from 'country-flag-icons/react/3x2/EG'
import ES from 'country-flag-icons/react/3x2/ES'
import FI from 'country-flag-icons/react/3x2/FI'
import FR from 'country-flag-icons/react/3x2/FR'
import GB from 'country-flag-icons/react/3x2/GB'
import GE from 'country-flag-icons/react/3x2/GE'
import GR from 'country-flag-icons/react/3x2/GR'
import IL from 'country-flag-icons/react/3x2/IL'
import IN from 'country-flag-icons/react/3x2/IN'
import IT from 'country-flag-icons/react/3x2/IT'
import JP from 'country-flag-icons/react/3x2/JP'
import KG from 'country-flag-icons/react/3x2/KG'
import KR from 'country-flag-icons/react/3x2/KR'
import KZ from 'country-flag-icons/react/3x2/KZ'
import LT from 'country-flag-icons/react/3x2/LT'
import LV from 'country-flag-icons/react/3x2/LV'
import MD from 'country-flag-icons/react/3x2/MD'
import NL from 'country-flag-icons/react/3x2/NL'
import NO from 'country-flag-icons/react/3x2/NO'
import PL from 'country-flag-icons/react/3x2/PL'
import RU from 'country-flag-icons/react/3x2/RU'
import SE from 'country-flag-icons/react/3x2/SE'
import TH from 'country-flag-icons/react/3x2/TH'
import TJ from 'country-flag-icons/react/3x2/TJ'
import TM from 'country-flag-icons/react/3x2/TM'
import TR from 'country-flag-icons/react/3x2/TR'
import UA from 'country-flag-icons/react/3x2/UA'
import US from 'country-flag-icons/react/3x2/US'
import UZ from 'country-flag-icons/react/3x2/UZ'
import VN from 'country-flag-icons/react/3x2/VN'

/** Типы `country-flag-icons` используют пересечение SVG/HTMLElement — здесь достаточно общего компонента. */
type AnyFlag = ComponentType<Record<string, unknown>>

const ISO_TO_FLAG: Record<string, AnyFlag> = {
  AE,
  AM,
  AU,
  AZ,
  BY,
  CA,
  CN,
  DE,
  EE,
  EG,
  ES,
  FI,
  FR,
  GB,
  GE,
  GR,
  IL,
  IN,
  IT,
  JP,
  KG,
  KR,
  KZ,
  LT,
  LV,
  MD,
  NL,
  NO,
  PL,
  RU,
  SE,
  TH,
  TJ,
  TM,
  TR,
  UA,
  US,
  UZ,
  VN,
}

type Props = {
  /** Название из `citizenships.name`; пусто / null — «не выбрано» (глобус приглушённый). */
  citizenshipName: string | null | undefined
  className?: string
}

export function CitizenshipFlag({ citizenshipName, className }: Props) {
  const name = citizenshipName?.trim()
  if (!name) {
    return (
      <Globe
        className={cn('h-4 w-4 shrink-0 text-muted-foreground opacity-50', className)}
        aria-hidden
      />
    )
  }

  const iso = citizenshipIsoCode(name)
  if (!iso) {
    return (
      <Globe className={cn('h-4 w-4 shrink-0 text-muted-foreground', className)} aria-hidden />
    )
  }

  const Flag = ISO_TO_FLAG[iso]
  if (!Flag) {
    return (
      <Globe className={cn('h-4 w-4 shrink-0 text-muted-foreground', className)} aria-hidden />
    )
  }

  return (
    <span
      className={cn(
        'inline-flex h-[1.125rem] w-6 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-border/50',
        className,
      )}
      aria-hidden
    >
      <Flag className="h-full w-full object-cover" />
    </span>
  )
}
