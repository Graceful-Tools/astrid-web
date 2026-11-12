"use client"

import { HelpContent } from "@/components/legal/HelpContent"
import { LegalFooter } from "@/components/legal/LegalFooter"
import { SettingsLegalLinks } from "@/components/legal/SettingsLegalLinks"

interface HelpPageProps {
  onNavigate: (page: string) => void
}

/** The in-app copy of the public /help page: the same text, in the Settings panel (AWTD-1584). */
export default function HelpPage({ onNavigate }: HelpPageProps) {
  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <HelpContent />

        <LegalFooter surface="settings">
          <SettingsLegalLinks pages={["terms", "privacy"]} onNavigate={onNavigate} />
        </LegalFooter>
      </div>
    </div>
  )
}
