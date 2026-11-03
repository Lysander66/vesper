import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { RunCenterProvider } from '@/lib/run-center'
import { Toaster } from '@/components/ui/sonner'
import { ProjectSidebar } from '@/components/project-sidebar'
import { TopBar } from '@/components/top-bar'

function RootLayout() {
  return (
    <RunCenterProvider>
      <div className='min-h-screen bg-background text-foreground'>
        <TopBar />
        <div className='flex min-h-[calc(100vh-52px)]'>
          <ProjectSidebar />
          <main className='min-w-0 flex-1 px-5 pt-4 pb-16'>
            <Outlet />
          </main>
        </div>
        <Toaster duration={5000} position='top-right' />
      </div>
    </RunCenterProvider>
  )
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: RootLayout,
})
