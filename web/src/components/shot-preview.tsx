import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ASSET_CATEGORY_LABEL, BINDING_ROLE_LABEL, type BindingRole, type ShotPreviewRef } from '@vesper/shared'
import { api, fileUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { hasOverrides, useDebounced, withoutPromptText, type LaunchParamsState } from '@/components/launch-params'
import { Lightbox } from '@/components/lightbox'
import { PromptBox } from '@/components/prompt-box'
import { ZoomHint } from '@/components/version-strip'

type ShotPart = 'first_frame' | 'clip'

// kind 是发给模型的提示词里的叫法，界面上按资产分类叫。
const kindLabel = (kind: string) => (kind === '人物' ? ASSET_CATEGORY_LABEL.character : kind)

const PART_ROLE: Record<ShotPart, BindingRole> = { first_frame: 'image', clip: 'video' }

export function ShotPreview({ shotId, part, state }: { shotId: string; part: ShotPart; state: LaunchParamsState }) {
  const { settled, preview } = useShotPreview(shotId, state)

  if (preview.isError) {
    return <p className='text-xs text-fail'>提示词计算失败：{preview.error.message}</p>
  }
  if (!preview.data) return null

  const text = part === 'first_frame' ? preview.data.first_frame : preview.data.clip
  const voices = part === 'clip' ? preview.data.voices : []
  const unbound = preview.data.unbound.includes(PART_ROLE[part])

  return (
    <div className='space-y-2'>
      <PromptBox
        purpose={part}
        text={text}
        state={state}
        className='max-h-64 rounded-md bg-line2/40 p-2'
        title={
          <>
            <Label className='text-xs'>最终提示词</Label>
            {hasOverrides(settled) && <span className='text-2xs text-brand'>含本次参数</span>}
            {unbound && <span className='text-2xs text-warn'>{BINDING_ROLE_LABEL[PART_ROLE[part]]}未配置</span>}
            {part === 'first_frame' && preview.data.off_frame.length > 0 && (
              <span className='text-2xs text-warn' title='视频只以首帧为参考，首帧中未出现的角色，在视频里的长相会与设定图不符'>
                首帧提示词中缺少{preview.data.off_frame.join('、')}
              </span>
            )}
            {part === 'clip' && preview.data.duration !== null && (
              <Badge variant='outline' className='font-mono'>
                {preview.data.duration} 秒
              </Badge>
            )}
          </>
        }
      />

      {voices.length > 0 && (
        <div className='flex flex-wrap items-center gap-2 pt-1'>
          <Label className='text-xs'>音色样本</Label>
          {voices.map((voice) => (
            <span key={voice.name} className={cn('text-2xs', voice.attached === 'no' && 'text-warn')}>
              {voice.name} · {voice.detail}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function useShotPreview(shotId: string, state: LaunchParamsState) {
  const settled = useDebounced(withoutPromptText(state.extra))
  const preview = useQuery({
    queryKey: ['shot-preview', shotId, settled],
    queryFn: () => api.shotPreview(shotId, settled),
  })
  return { settled, preview }
}

export function ShotRefs({ shotId, state }: { shotId: string; state: LaunchParamsState }) {
  const { preview } = useShotPreview(shotId, state)
  const [viewing, setViewing] = useState<number | null>(null)
  const refs = preview.data?.refs ?? []
  if (refs.length === 0) return null
  const dropped = refs.filter((ref) => ref.attached === 'no')

  return (
    <div className='space-y-2 pt-1'>
      <div className='flex flex-wrap items-center gap-2'>
        <h4 className='text-2xs font-semibold text-ink3'>参考图</h4>
        <span className='font-mono text-2xs text-ink3'>
          {refs.length - dropped.length}/{refs.length}
        </span>
        {dropped.length > 0 && <span className='text-2xs text-warn'>{dropped.length} 张超出上限</span>}
      </div>
      <div className='flex flex-wrap gap-2'>
        {refs.map((ref, i) => (
          <RefChip key={`${ref.path}-${i}`} slot={ref} seq={ref.attached === 'yes' ? i + 1 : null} onOpen={() => setViewing(i)} />
        ))}
      </div>
      <Lightbox images={refs.map((ref) => ({ path: ref.path, label: ref.name === '' ? kindLabel(ref.kind) : ref.name }))} index={viewing} onIndexChange={setViewing} />
    </div>
  )
}

/** 序号与提示词里「第 N 张是某某」对应，按实际附上的顺序编号，未附上的不占号。 */
function RefChip({ slot, seq, onOpen }: { slot: ShotPreviewRef; seq: number | null; onOpen: () => void }) {
  const [broken, setBroken] = useState(false)
  const excluded = slot.attached === 'no'

  return (
    <figure className={cn('w-20 space-y-1', excluded && 'opacity-50')} title={slot.anchor === '' ? undefined : slot.anchor}>
      <div className={cn('relative grid aspect-square place-items-center overflow-hidden rounded-md border bg-line2/40', excluded && 'border-dashed')}>
        {broken ? (
          <span className='text-2xs text-ink3'>待生成</span>
        ) : (
          <button type='button' aria-label='查看大图' className='group relative h-full w-full' onClick={onOpen}>
            <img src={fileUrl(slot.path)} alt='' className='h-full w-full object-cover' onError={() => setBroken(true)} />
            <ZoomHint />
          </button>
        )}
        {seq !== null && <span className='absolute top-0 left-0 rounded-br-sm bg-card/90 px-1 font-mono text-2xs text-ink3'>{seq}</span>}
      </div>
      <figcaption className='truncate text-2xs'>{slot.name === '' ? kindLabel(slot.kind) : slot.name}</figcaption>
      {slot.name !== '' && <div className='truncate text-2xs text-ink3'>{kindLabel(slot.kind)}</div>}
    </figure>
  )
}
