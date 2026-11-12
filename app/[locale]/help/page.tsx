import { BRAND } from '@/lib/brand/config'
import { LegalPageShell } from "@/components/legal/LegalPageShell"
import { HelpContent } from "@/components/legal/HelpContent"

export const metadata = {
  title: `Help & Troubleshooting - ${BRAND.appName}`,
  description: `Common solutions for syncing issues, missing data, and other problems with ${BRAND.appName}`,
}

export default function HelpPage() {
  return (
    <LegalPageShell width="max-w-4xl" links={["terms", "privacy"]}>
      <HelpContent />
    </LegalPageShell>
  )
}
