import { DayPicker, type DayPickerProps } from 'react-day-picker'

import { cn } from '@/lib/utils'

export function Calendar({ className, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      className={cn('rounded-md border p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-3',
        month: 'space-y-3',
        caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        nav_button: 'h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100',
        table: 'w-full border-collapse space-y-1',
        head_row: 'flex',
        head_cell: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        row: 'flex w-full mt-2',
        cell: 'text-center text-sm p-0 relative',
        day: 'h-8 w-8 p-0 font-normal rounded-md hover:bg-muted',
        day_selected: 'bg-primary text-primary-foreground hover:bg-primary',
        day_today: 'border border-primary',
      }}
      {...props}
    />
  )
}
