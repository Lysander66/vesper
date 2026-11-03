import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { VoicePreset } from '@vesper/shared'
import { Check, Pause, Play } from 'lucide-react'
import { api, fileUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EmptyState, LoadingState } from '@/components/layout/page'
import { Segmented } from '@/components/ui/segmented'

const GENDERS = ['男', '女', ''] as const
const AGES = ['儿童', '青年', '成年', '老年', ''] as const

export function useVoices() {
  return useQuery({ queryKey: ['voices'], queryFn: api.voices })
}

export function VoiceList({ onPick, picking = false }: { onPick?: (voice: VoicePreset) => void; picking?: boolean }) {
  const voices = useVoices()
  const [picked, setLanguage] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])

  const toggle = (voice: VoicePreset) => {
    audio.current?.pause()
    if (playing === voice.id) {
      setPlaying(null)
      return
    }
    const next = new Audio(fileUrl(voice.path))
    next.onended = () => setPlaying(null)
    void next.play()
    audio.current = next
    setPlaying(voice.id)
  }

  const all = voices.data ?? []
  if (voices.isPending) return <LoadingState />
  if (all.length === 0) return <EmptyState>暂无预置音色</EmptyState>

  const languages = [...new Set(all.map((voice) => voice.language))]
  const language = picked !== null && languages.includes(picked) ? picked : languages.includes('普通话') ? '普通话' : languages[0]!
  const shown = all.filter((voice) => voice.language === language)
  return (
    <div className='space-y-4'>
      {languages.length > 1 && <Segmented value={language} options={languages} onChange={setLanguage} className='w-fit' />}
      {GENDERS.map((gender) => {
        const rows = AGES.map((age) => ({ age, items: shown.filter((voice) => voice.gender === gender && voice.age === age) })).filter((row) => row.items.length > 0)
        if (rows.length === 0) return null
        return (
          <section key={gender} className='space-y-1.5'>
            <h4 className='text-xs font-medium text-muted-foreground'>{gender === '' ? '其他' : gender}</h4>
            {rows.map(({ age, items }) => (
              <div key={age} className='flex gap-2'>
                <span className='w-8 shrink-0 pt-1.5 text-2xs text-idle'>{age}</span>
                <div className='flex flex-wrap gap-1.5'>
                  {items.map((voice) => (
                    <div key={voice.id} className={cn('flex items-center rounded-md border bg-card text-xs', playing === voice.id && 'border-brand')}>
                      <button type='button' className='flex items-center gap-1 px-2 py-1' title='试听' aria-label={`试听${voice.name}`} onClick={() => toggle(voice)}>
                        {playing === voice.id ? <Pause className='h-3.5 w-3.5' /> : <Play className='h-3.5 w-3.5' />}
                        {voice.name}
                      </button>
                      {onPick && (
                        <button
                          type='button'
                          className='border-l px-1.5 py-1 text-ink3 hover:bg-line2 hover:text-foreground disabled:opacity-50'
                          title='使用此音色'
                          aria-label='使用此音色'
                          disabled={picking}
                          onClick={() => onPick(voice)}
                        >
                          <Check className='h-3.5 w-3.5' />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
