import { BRAND } from '@/lib/brand/config'

/** The mascot speech bubble shown beside settings in the wide two-pane layout. */
export function SettingsSecondPane() {
  return (
    <div className="flex-1 min-w-[280px] border-l theme-border flex items-center justify-center p-8">
      <div className="flex flex-col items-center max-w-xs">
        <div className="flex items-start space-x-4 w-full">
          <div className="flex-shrink-0 w-24">
            <img src={BRAND.icon} alt={BRAND.appName} className="w-full h-auto" />
          </div>
          <div className="flex-1">
            <div className="relative theme-bg-secondary rounded-2xl p-4 border theme-border">
              <div className="absolute -left-[14px] top-6 w-0 h-0 border-t-[10px] border-t-transparent border-r-[14px] border-b-[10px] border-b-transparent border-l-0 z-10 speech-bubble-arrow-fill"></div>
              <p className="text-sm font-medium theme-text-primary leading-relaxed">
                Help me help you become super productive!!!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
