import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ASSET_CATEGORY_LABEL, CHARACTER_FORMS, CHARACTER_FORM_LABEL, type AssetCategory, type AssetView, type CastTier, type CharacterForm, type VoicePreset } from '@vesper/shared'
import { AudioLines, Check, Mic } from 'lucide-react'
import { toast } from 'sonner'
import { api, fileUrl, type AssetPatch } from '@/lib/api'
import { useLaunch } from '@/lib/run-center'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { TextField } from '@/components/ui/text-field'
import { ToggleChip } from '@/components/ui/toggle-chip'
import { LaunchGroup, useLaunchParams } from '@/components/launch-params'
import { RunLog } from '@/components/run-log'
import { VoiceList } from '@/components/voices'
import { Looks } from './looks'

export const TIER_LABEL: Record<CastTier, string> = { lead: '主角', support: '配角' }

export function AssetSheet({ asset, locked, open, onOpenChange }: { asset: AssetView; locked: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className='flex items-center gap-2 border-b px-4 py-3'>
          <SheetTitle>{asset.name}</SheetTitle>
          <span className='text-xs text-muted-foreground'>{ASSET_CATEGORY_LABEL[asset.category]}</span>
        </div>
        <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-4'>
          <Looks asset={asset} locked={locked} />
          {asset.base_id !== null ? (
            <CostumeFields asset={asset} baseId={asset.base_id} locked={locked} />
          ) : (
            <>
              <AssetFields asset={asset} locked={locked} />
              {asset.category === 'character' && <VoiceSample asset={asset} locked={locked} />}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface FieldRow {
  key: 'identity' | 'traits' | 'outfit' | 'voice' | 'lighting' | 'description' | 'holder'
  label: string
  area?: boolean
}

const FIELD_ROWS: Readonly<Record<AssetCategory, readonly FieldRow[]>> = {
  character: [
    { key: 'identity', label: '身份' },
    { key: 'traits', label: '外貌', area: true },
    { key: 'outfit', label: '服装', area: true },
    { key: 'voice', label: '声音' },
  ],
  // 光线单独成字段：同一地点的白天与夜里是两个场景，混在环境描述里模型会画乱。
  scene: [
    { key: 'lighting', label: '光线' },
    { key: 'description', label: '环境', area: true },
  ],
  prop: [
    { key: 'holder', label: '归属' },
    { key: 'description', label: '外观', area: true },
  ],
}

function CostumeFields({ asset, baseId, locked }: { asset: AssetView; baseId: string; locked: boolean }) {
  const base = useQuery({ queryKey: ['asset', baseId], queryFn: () => api.asset(baseId) })
  const [outfit, setOutfit] = useState(asset.category === 'character' ? asset.data.outfit : '')
  const save = useSave(asset.id)
  const person = base.data?.category === 'character' ? base.data.data : null

  return (
    <>
      <div className='space-y-2.5'>
        <TextField label='服装' value={outfit} disabled={locked} onChange={setOutfit} rows={2} />
        {!locked && (
          <Button className='w-full' size='sm' disabled={save.isPending} onClick={() => save.mutate({ outfit })}>
            保存设定
          </Button>
        )}
      </div>
      {person && base.data && (
        <div className='space-y-1.5 border-t pt-3 text-xs'>
          <p className='text-muted-foreground'>
            以下沿用{base.data.name}的设定，如需修改请编辑{base.data.name}
          </p>
          {[
            ['身份', person.identity],
            ['外貌', person.traits],
            ['声音', person.voice],
          ].map(([label, value]) => (
            <p key={label}>
              <span className='text-muted-foreground'>{label}：</span>
              {value || '—'}
            </p>
          ))}
        </div>
      )}
    </>
  )
}

function AssetFields({ asset, locked }: { asset: AssetView; locked: boolean }) {
  const rows = FIELD_ROWS[asset.category]
  const data = asset.data as Partial<Record<FieldRow['key'], string>>
  const [draft, setDraft] = useState(() => ({
    aliases: asset.data.aliases.join('、'),
    ...(Object.fromEntries(rows.map((row) => [row.key, data[row.key] ?? ''])) as Record<FieldRow['key'], string>),
  }))
  const [tier, setTier] = useState<CastTier>(asset.category === 'character' ? asset.data.tier : 'support')
  const [form, setForm] = useState<CharacterForm>(asset.category === 'character' ? asset.data.form : 'human')
  const save = useSave(asset.id)

  const patch: AssetPatch = { aliases: splitAliases(draft.aliases) }
  for (const row of rows) patch[row.key] = draft[row.key]
  if (asset.category === 'character') {
    patch.tier = tier
    patch.form = form
  }

  return (
    <>
      <div className='space-y-2.5'>
        {asset.category === 'character' && (
          // 角色定位决定补齐几张设定图，也就决定了费用，所以排在第一条。
          <div className='space-y-1.5'>
            <Label className='text-xs'>角色定位</Label>
            <div className='flex flex-wrap items-center gap-1'>
              {(Object.keys(TIER_LABEL) as CastTier[]).map((item) => (
                <ToggleChip key={item} on={tier === item} disabled={locked} onClick={() => setTier(item)}>
                  {TIER_LABEL[item]}
                </ToggleChip>
              ))}
              <span className='mx-1 h-4 w-px bg-border' />
              {CHARACTER_FORMS.map((item) => (
                <ToggleChip key={item} on={form === item} disabled={locked} onClick={() => setForm(item)}>
                  {CHARACTER_FORM_LABEL[item]}
                </ToggleChip>
              ))}
            </div>
          </div>
        )}
        <TextField label='别名' value={draft.aliases} disabled={locked} onChange={(v) => setDraft({ ...draft, aliases: v })} />
        {rows.map((row) => (
          <TextField key={row.key} label={row.label} value={draft[row.key]} disabled={locked} onChange={(v) => setDraft({ ...draft, [row.key]: v })} rows={row.area ? 2 : undefined} />
        ))}
      </div>
      {!locked && (
        <Button className='w-full' size='sm' disabled={save.isPending} onClick={() => save.mutate(patch)}>
          保存设定
        </Button>
      )}
    </>
  )
}

function VoiceSample({ asset, locked }: { asset: AssetView; locked: boolean }) {
  const [line, setLine] = useState('今天天气不错，我先去山上走一走，晌午前就回来，你不用等我。')
  const params = useLaunchParams({ projectId: asset.project_id ?? '', roles: ['tts'] })
  const voice = useLaunch(() => api.voiceSample(asset.id, line, params.extra))
  const queryClient = useQueryClient()
  const pick = useMutation({
    mutationFn: (fileId: number) => api.restoreAssetFile(asset.id, fileId),
    onSuccess: async () => {
      toast.success('已切换试音')
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  // 选用旧样本会追加一行同路径的记录，按路径去重。
  const samples = asset.files.filter((file) => file.role === 'voice_sample').filter((file, index, rows) => rows.findIndex((row) => row.path === file.path) === index)

  return (
    <div className='space-y-1.5 border-t pt-3'>
      <Label className='text-xs'>试音</Label>
      <Input value={line} onChange={(event) => setLine(event.target.value)} disabled={locked} />
      {asset.project_id ? (
        <LaunchGroup state={params} onLaunch={voice.trigger} icon={Mic} label='试音' variant='outline' className='w-full [&>button:first-child]:flex-1' busy={locked || voice.busy} />
      ) : (
        <Button size='sm' variant='outline' className='w-full' disabled={locked || voice.busy} onClick={voice.trigger}>
          <Mic className='h-3.5 w-3.5' />
          试音
        </Button>
      )}
      <VoicePresets asset={asset} locked={locked} />
      {samples.map((file, index) => (
        <div key={file.id} className='space-y-1'>
          <div className='flex items-center gap-1.5 text-2xs text-muted-foreground'>
            {index === 0 ? (
              <Badge variant='muted' className='px-1.5 text-2xs'>
                当前
              </Badge>
            ) : (
              <Button size='sm' variant='ghost' className='-my-1 h-6 px-1.5 text-xs' disabled={locked || pick.isPending} onClick={() => pick.mutate(file.id)}>
                <Check className='h-3.5 w-3.5' />
                使用此音色
              </Button>
            )}
            <span className='truncate' title={file.label}>
              {file.label}
            </span>
          </div>
          <audio src={fileUrl(file.path)} controls className='h-8 w-full' />
        </div>
      ))}
      {voice.runId && <RunLog runId={voice.runId} />}
    </div>
  )
}

function VoicePresets({ asset, locked }: { asset: AssetView; locked: boolean }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const apply = useMutation({
    mutationFn: (voice: VoicePreset) => api.applyVoice(asset.id, voice.id),
    onSuccess: async (_view, voice) => {
      toast.success(`试音已改为「${voice.name}」`)
      await queryClient.invalidateQueries()
      setOpen(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size='sm' variant='outline' className='w-full' disabled={locked}>
          <AudioLines className='h-3.5 w-3.5' />
          选预置音色
        </Button>
      </DialogTrigger>
      <DialogContent className='max-h-[85vh] max-w-xl overflow-y-auto'>
        <DialogTitle>{asset.name} · 预置音色</DialogTitle>
        {open && <VoiceList picking={apply.isPending} onPick={apply.mutate} />}
      </DialogContent>
    </Dialog>
  )
}

function useSave(assetId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: AssetPatch) => api.patchAsset(assetId, patch),
    onSuccess: async () => {
      toast.success('已保存')
      await queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

function splitAliases(value: string): string[] {
  return value.split(/[、,，\s]+/).filter(Boolean)
}
