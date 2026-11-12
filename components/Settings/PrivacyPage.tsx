"use client"

import { BRAND } from '@/lib/brand/config'
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent"
import { LegalFooter } from "@/components/legal/LegalFooter"
import { SettingsLegalLinks } from "@/components/legal/SettingsLegalLinks"

interface PrivacyPageProps {
  onNavigate: (page: string) => void
}

/** The in-app copy of the public /privacy page: the same text, in the Settings panel (AWTD-1584). */
export default function PrivacyPage({ onNavigate }: PrivacyPageProps) {
  // The operator publishes its own; ours would be a policy for a service it does not run.
  if (BRAND.privacyUrl) {
    return (
      <div className="p-2 sm:p-4">
        <a href={BRAND.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover">
          {BRAND.privacyUrl}
        </a>
      </div>
    )
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <PrivacyPolicyContent />

        <LegalFooter surface="settings">
          <SettingsLegalLinks pages={["terms"]} onNavigate={onNavigate} />
        </LegalFooter>
      </div>
    </div>
  )
}
