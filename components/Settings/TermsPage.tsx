"use client"

import { BRAND } from '@/lib/brand/config'
import { TermsOfServiceContent } from "@/components/legal/TermsOfServiceContent"
import { LegalFooter } from "@/components/legal/LegalFooter"
import { SettingsLegalLinks } from "@/components/legal/SettingsLegalLinks"

interface TermsPageProps {
  onNavigate: (page: string) => void
}

/** The in-app copy of the public /terms page: the same text, in the Settings panel (AWTD-1584). */
export default function TermsPage({ onNavigate }: TermsPageProps) {
  // The operator publishes its own; ours would be a policy for a service it does not run.
  if (BRAND.termsUrl) {
    return (
      <div className="p-2 sm:p-4">
        <a href={BRAND.termsUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover">
          {BRAND.termsUrl}
        </a>
      </div>
    )
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <TermsOfServiceContent />

        <LegalFooter surface="settings">
          <SettingsLegalLinks pages={["privacy"]} onNavigate={onNavigate} />
        </LegalFooter>
      </div>
    </div>
  )
}
