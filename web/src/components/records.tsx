import { Link } from '@tanstack/react-router'
import { ExternalLink, Terminal } from 'lucide-react'
import { purposeLabel, type RecordsOwner } from '@/lib/records'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { JobCalls } from '@/components/job-calls'

export function RecordsLink({ owner, label = '调用记录' }: { owner: RecordsOwner; label?: string }) {
  return (
    <Button asChild variant='outline' size='sm' title={label === '' ? '调用记录' : undefined} aria-label={label === '' ? '调用记录' : undefined}>
      <Link to='/records' search={{ owner_kind: owner.kind, owner_id: owner.id }}>
        <Terminal className='h-3.5 w-3.5' />
        {label}
      </Link>
    </Button>
  )
}

export function CallsDialog({ jobId, purpose, owner, open, onOpenChange }: { jobId: string; purpose: string | null; owner: RecordsOwner; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-6xl'>
        <div className='flex items-center gap-2'>
          <DialogTitle>{purposeLabel(purpose)}</DialogTitle>
          <Link to='/records' search={{ owner_kind: owner.kind, owner_id: owner.id, job: jobId }} className='flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground'>
            <ExternalLink className='h-3.5 w-3.5' />
            调用记录
          </Link>
        </div>
        {open && <JobCalls jobId={jobId} />}
      </DialogContent>
    </Dialog>
  )
}
