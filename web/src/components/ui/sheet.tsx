import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot='sheet' {...props} />
}

function SheetContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal data-slot='sheet-portal'>
      <DialogPrimitive.Overlay
        data-slot='sheet-overlay'
        className='fixed inset-0 z-50 bg-black/30 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0'
      />
      <DialogPrimitive.Content
        data-slot='sheet-content'
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l bg-background shadow-lg duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot='sheet-close'
          className='absolute end-3 top-3 grid size-6 place-items-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden [&_svg]:size-4'
        >
          <XIcon />
          <span className='sr-only'>关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot='sheet-title' className={cn('text-sm leading-none font-semibold', className)} {...props} />
}

export { Sheet, SheetContent, SheetTitle }
