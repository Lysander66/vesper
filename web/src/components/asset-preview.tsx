import { useQuery } from '@tanstack/react-query'
import { ASSET_FILE_ROLE_LABEL } from '@vesper/shared'
import { api, type LaunchExtra } from '@/lib/api'
import { hasOverrides, useDebounced, withoutPromptText, type LaunchParamsState } from '@/components/launch-params'
import { PromptBox } from '@/components/prompt-box'

const NONE: LaunchExtra = {}

export function AssetPreview({ assetId, state }: { assetId: string; state?: LaunchParamsState }) {
  const settled = useDebounced(state ? withoutPromptText(state.extra) : NONE)
  const preview = useQuery({
    queryKey: ['asset-preview', assetId, settled],
    queryFn: () => api.assetPreview(assetId, settled),
  })

  if (preview.isError) {
    return <div className='rounded-lg border bg-card p-3 text-xs text-fail'>提示词计算失败：{preview.error.message}</div>
  }
  if (!preview.data) return null

  const look = preview.data.looks[0]
  if (!look) return null

  return (
    <PromptBox
      purpose={`look_${look.role}`}
      text={look.prompt}
      state={state}
      className='max-h-56 rounded-lg border p-3'
      title={
        <>
          <h4 className='text-sm font-semibold'>最终提示词</h4>
          <span className='text-2xs text-ink3'>{ASSET_FILE_ROLE_LABEL[look.role]}</span>
          {hasOverrides(settled) && <span className='text-2xs text-brand'>含本次参数</span>}
          {preview.data.unbound.length > 0 && <span className='text-2xs text-warn'>图像未配置</span>}
        </>
      }
    />
  )
}
