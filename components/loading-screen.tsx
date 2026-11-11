
interface LoadingScreenProps {
  message?: string
}

export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
  return (
    <div className="app-container theme-bg-primary theme-text-primary">
      <div className="desktop-layout">
        {/* Sidebar skeleton */}
        <div className="app-sidebar theme-border">
          <div className="p-4">
            <div className="animate-pulse">
              <div className="h-8 bg-theme-active rounded w-20 mb-4"></div>
              <div className="space-y-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="h-10 bg-theme-active rounded"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        {/* Main content skeleton */}
        <div className="desktop-main">
          {/* Header skeleton */}
          <div className="app-header theme-header theme-border">
            <div className="flex items-center space-x-4">
              <div className="animate-pulse h-6 bg-theme-active rounded w-24"></div>
              <div className="flex-1"></div>
              <div className="animate-pulse h-8 w-8 bg-theme-active rounded-full"></div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  )
}
