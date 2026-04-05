"use client"

import { OAuthAPITester } from "@/components/oauth-api-tester"

interface ApiTestingSettingsProps {
  onNavigate: (page: string) => void
}

export default function ApiTestingSettings({ onNavigate }: ApiTestingSettingsProps) {
  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <OAuthAPITester />
      </div>
    </div>
  )
}
