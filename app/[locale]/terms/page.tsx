import { redirect } from "next/navigation"
import { BRAND } from '@/lib/brand/config'
import { LegalPageShell } from "@/components/legal/LegalPageShell"
import { TermsOfServiceContent } from "@/components/legal/TermsOfServiceContent"

export default function TermsOfService() {
  // A partner that publishes its own terms serves those, not ours (AWTD-1584).
  if (BRAND.termsUrl) redirect(BRAND.termsUrl)

  return (
    <LegalPageShell width="max-w-3xl" links={["privacy"]}>
      <TermsOfServiceContent />
    </LegalPageShell>
  )
}
