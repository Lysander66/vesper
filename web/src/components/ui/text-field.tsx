import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function TextField({
  label,
  value,
  onChange,
  rows,
  disabled,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <div className='min-w-0 space-y-1.5'>
      <Label className='text-xs'>{label}</Label>
      {rows ? (
        <Textarea value={value} rows={rows} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  )
}
