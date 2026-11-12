import { useTranslations } from '@/lib/i18n/client'
import { BRAND } from '@/lib/brand/config'

/** The mascot speech bubble shown beside settings in the wide two-pane layout. */
export function SettingsSecondPane() {
  const { t } = useTranslations()
  return (
    <div className="flex-1 min-w-pane-min border-l theme-border flex items-center justify-center p-8">
      <div className="flex flex-col items-center max-w-xs">
        <div className="flex items-start space-x-4 w-full">
          <div className="flex-shrink-0 w-24">
            <img src={BRAND.icon} alt={BRAND.appName} className="w-full h-auto" />
          </div>
          <div className="flex-1">
            <div className="relative theme-bg-secondary rounded-2xl p-4 border theme-border">
              <div aria-hidden="true" className="speech-bubble-tail speech-bubble-tail-small speech-bubble-arrow-fill" />
              <p className="text-sm font-medium theme-text-primary leading-relaxed">
                {t('settings.helpMeHelpYou')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
