import { redirect } from "next/navigation"
import { BRAND } from '@/lib/brand/config'
import { LegalPageShell } from "@/components/legal/LegalPageShell"
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent"

export default function PrivacyPolicy() {
  // A partner that publishes its own policy serves that, not ours (AWTD-1584).
  if (BRAND.privacyUrl) redirect(BRAND.privacyUrl)

  return (
    <LegalPageShell width="max-w-3xl" links={["terms"]}>
      <PrivacyPolicyContent />
    </LegalPageShell>
  )
}
