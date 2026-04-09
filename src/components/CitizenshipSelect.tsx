import { CitizenshipFlag } from '@/components/CitizenshipFlag'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { type Citizenship } from '@/types/models'

const NONE = '__citizenship_none__'

type Props = {
  id?: string
  /** Пустая строка — не выбрано */
  value: string
  onChange: (value: string) => void
  citizenships: Citizenship[]
  disabled?: boolean
  className?: string
}

export function CitizenshipSelect({
  id,
  value,
  onChange,
  citizenships,
  disabled,
  className,
}: Props) {
  const selected = citizenships.find((c) => String(c.id) === value.trim())
  const selectedId = value.trim() ? value.trim() : NONE
  const label = selected?.name ?? 'Не указано'

  return (
    <Select
      value={selectedId}
      onValueChange={(v) => onChange(v === NONE ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={`Гражданство: ${label}`}
        className={cn('min-w-0', className)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden pr-1">
          <span className="flex shrink-0 items-center justify-center self-center">
            <CitizenshipFlag citizenshipName={selected?.name} />
          </span>
          <span className="min-w-0 flex-1 truncate text-left leading-5">{label}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} textValue="Не указано">
          <span className="flex items-center gap-3">
            <span className="flex w-6 shrink-0 items-center justify-center">
              <CitizenshipFlag citizenshipName={null} />
            </span>
            <SelectItemText className="leading-5">Не указано</SelectItemText>
          </span>
        </SelectItem>
        {citizenships.map((c) => (
          <SelectItem key={c.id} value={String(c.id)} textValue={c.name}>
            <span className="flex items-center gap-3">
              <span className="flex w-6 shrink-0 items-center justify-center">
                <CitizenshipFlag citizenshipName={c.name} />
              </span>
              <SelectItemText className="leading-5">{c.name}</SelectItemText>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
