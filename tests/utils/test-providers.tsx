import { ReactElement, ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'

interface TestSessionProviderProps {
  children: ReactNode
  session?: any
}

export const TestSessionProvider = ({ 
  children, 
  session = {
    user: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: null
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
  }
}: TestSessionProviderProps) => {
  return (
    <SessionProvider session={session}>
      {children}
    </SessionProvider>
  )
}

// Custom render function that includes providers by default
import { render, RenderOptions } from '@testing-library/react'

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  session?: any
}

export const renderWithProviders = (
  ui: ReactElement,
  { session, ...renderOptions }: CustomRenderOptions = {}
) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <TestSessionProvider session={session}>
      {children}
    </TestSessionProvider>
  )

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}