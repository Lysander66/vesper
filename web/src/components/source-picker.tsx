import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface SourceFile {
  name: string
  text: string
}

/** 中文小说的 txt 常是 GBK：先按 UTF-8 严格解码，失败再按 GBK。 */
async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

interface SourceState {
  files: SourceFile[]
  pasted: string
  payload: SourceFile[]
  setPasted: (text: string) => void
  remove: (name: string) => void
  addFiles: (picked: FileList | null) => Promise<void>
  reset: () => void
}

export function useSourceState(pasteName: () => string, onFirstFile?: (name: string) => void): SourceState {
  const [files, setFiles] = useState<SourceFile[]>([])
  const [pasted, setPasted] = useState('')

  const addFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return
    try {
      // 按文件名排序而不是选择顺序：集序不该取决于框选方向。
      const list = [...picked].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      const read = await Promise.all(list.map(async (file) => ({ name: file.name, text: await readText(file) })))
      setFiles((current) => [...current, ...read.filter((f) => !current.some((c) => c.name === f.name))])
      const first = read[0]
      if (first && onFirstFile) onFirstFile(first.name)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    files,
    pasted,
    payload: pasted.trim() === '' ? files : [...files, { name: pasteName(), text: pasted }],
    setPasted,
    remove: (name) => setFiles((current) => current.filter((f) => f.name !== name)),
    addFiles,
    reset: () => {
      setFiles([])
      setPasted('')
    },
  }
}

export function SourcePicker({ state, label, id }: { state: SourceState; label: string; id: string }) {
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void state.addFiles(event.dataTransfer.files)
        }}
        className={cn('rounded-md', dragging && 'ring-2 ring-brand')}
      >
        <Textarea id={id} value={state.pasted} onChange={(event) => state.setPasted(event.target.value)} rows={state.files.length > 0 ? 4 : 10} placeholder='拖入 txt，或粘贴原文…' />
      </div>
      {state.files.length > 0 && (
        <ul className='divide-y rounded-md border'>
          {state.files.map((file, i) => (
            <li key={file.name} className='flex items-center gap-2 px-2.5 py-1.5 text-xs'>
              <span className='font-mono text-2xs text-ink3'>第 {i + 1} 份</span>
              <span className='truncate'>{file.name}</span>
              <span className='ml-auto shrink-0 font-mono text-2xs text-ink3'>{file.text.length} 字符</span>
              <button type='button' title='移除' aria-label={`移除${file.name}`} className='shrink-0 text-muted-foreground hover:text-fail' onClick={() => state.remove(file.name)}>
                <X className='h-3.5 w-3.5' />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <span className='font-mono'>{state.payload.length} 份原文</span>
        <Button variant='ghost' size='sm' className='ml-auto' onClick={() => fileInput.current?.click()}>
          <Upload className='h-3.5 w-3.5' />
          选择文件
        </Button>
        <input
          ref={fileInput}
          type='file'
          multiple
          accept='.txt,.md,text/plain'
          className='hidden'
          onChange={(event) => {
            void state.addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
