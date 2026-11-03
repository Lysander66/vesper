import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ASSET_CATEGORY_LABEL, type AssetCategory, type LibraryItem } from '@vesper/shared'
import { api } from '@/lib/api'
import { EmptyState, LoadingState, PageHeader } from '@/components/layout/page'
import { Segmented } from '@/components/ui/segmented'
import { DeleteLibraryPrompt, LibraryTile } from '@/components/library'
import { useVoices, VoiceList } from '@/components/voices'

export const Route = createFileRoute('/library')({ component: LibraryPage })

const CATEGORIES = ['character', 'scene', 'prop'] as const satisfies readonly AssetCategory[]
const TABS = [...CATEGORIES, 'voice'] as const

function LibraryPage() {
  const library = useQuery({ queryKey: ['library'], queryFn: api.library })
  const voices = useVoices()
  const [tab, setTab] = useState<(typeof TABS)[number]>('character')
  const category = tab === 'voice' ? 'character' : tab
  const [deleting, setDeleting] = useState<LibraryItem | null>(null)
  const items = library.data?.filter((item) => item.category === category) ?? []
  const count = (c: AssetCategory) => library.data?.filter((item) => item.category === c).length ?? 0

  return (
    <div className='mx-auto w-full max-w-6xl space-y-6'>
      <PageHeader title='素材库' lead='在作品的资产卡上存入，在别的作品里复制过去再改' />
      <Segmented value={tab} options={TABS} onChange={setTab} render={(t) => (t === 'voice' ? `音色 ${voices.data?.length ?? 0}` : `${ASSET_CATEGORY_LABEL[t]} ${count(t)}`)} className='w-fit' />
      {tab === 'voice' ? (
        <VoiceList />
      ) : library.isPending ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState>暂无{ASSET_CATEGORY_LABEL[category]}</EmptyState>
      ) : (
        <div className='grid gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6'>
          {items.map((item) => (
            <LibraryTile key={item.id} item={item} onDelete={() => setDeleting(item)} />
          ))}
        </div>
      )}
      <DeleteLibraryPrompt item={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </div>
  )
}
