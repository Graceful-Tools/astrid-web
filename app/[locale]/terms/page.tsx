import { BRAND } from '@/lib/brand/config'
import Link from "next/link"
import Image from "next/image"
import { ScrollShell } from "@/components/scroll-shell"

export default function TermsOfService() {
  return (
    <ScrollShell className="bg-black text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="container mx-auto px-4 py-6">
          <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
            <Image src="/icons/icon-96x96.png" alt={BRAND.appName} width={32} height={32} className="rounded" />
            <span className="text-2xl font-bold text-white">astrid</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-4xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-gray-500 mb-10">Last updated: January 3, 2026</p>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">The Service</h2>
            <p className="text-gray-300 leading-relaxed">
              {BRAND.appName} is a task management application operated by Graceful Tools LLC.
              By using {BRAND.appName}, you agree to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Your Account</h2>
            <p className="text-gray-300 leading-relaxed">
              You&apos;re responsible for your account security and all activity under it.
              Keep your credentials safe and notify us of any unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Your Content</h2>
            <p className="text-gray-300 leading-relaxed">
              You own everything you create in {BRAND.appName}. We only use your content to
              provide the service—storing, syncing, and displaying it back to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Acceptable Use</h2>
            <p className="text-gray-300 leading-relaxed mb-3">
              Don&apos;t use {BRAND.appName} to:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-1 ml-2">
              <li>Break any laws</li>
              <li>Harass or harm others</li>
              <li>Distribute malware or spam</li>
              <li>Attempt to access others&apos; accounts</li>
              <li>Interfere with the service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">External Services</h2>
            <p className="text-gray-300 leading-relaxed">
              {BRAND.appName} connects with Google and Apple for sign-in. When using these
              integrations, their respective terms apply.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Service Changes</h2>
            <p className="text-gray-300 leading-relaxed">
              We may modify or discontinue features at any time. We&apos;ll try to give
              notice for significant changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Warranty Disclaimer</h2>
            <p className="text-gray-300 leading-relaxed">
              {BRAND.appName} is provided &quot;as is&quot; without warranties of any kind. We don&apos;t
              guarantee uptime, accuracy, or that the service will meet your specific needs.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Limitation of Liability</h2>
            <p className="text-gray-300 leading-relaxed">
              To the extent permitted by law, Graceful Tools LLC isn&apos;t liable for
              indirect damages, data loss, or service interruptions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Termination</h2>
            <p className="text-gray-300 leading-relaxed">
              You can delete your account anytime. We may suspend accounts that
              violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p className="text-gray-300 leading-relaxed">
              Questions? Reach us at{" "}
              <a href={`mailto:legal@${BRAND.domain}`} className="text-blue-400 hover:text-blue-300">
                legal@{BRAND.domain}
              </a>
            </p>
          </section>
        </div>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center text-sm text-gray-400">
            <p>© {new Date().getFullYear()} Graceful Tools LLC</p>
            <div className="flex gap-6">
              <Link href="/privacy" className="hover:text-white transition-colors">
                Privacy Policy
              </Link>
              <Link href="/" className="hover:text-white transition-colors">
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    </ScrollShell>
  )
}
