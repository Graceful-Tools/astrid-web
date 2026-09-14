import { BRAND } from '@/lib/brand/config'
import Link from "next/link"
import Image from "next/image"
import { ScrollShell } from "@/components/scroll-shell"

export default function PrivacyPolicy() {
  return (
    <ScrollShell className="bg-black text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="container mx-auto px-4 py-6">
          <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={32} height={32} className="rounded" />
            <span className="text-2xl font-bold text-white">{BRAND.wordmark}</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-500 mb-10">Last updated: September 14, 2026</p>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">What We Collect</h2>
            <p className="text-gray-300 leading-relaxed mb-3">
              We collect information you provide directly:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-1 ml-2">
              <li>Account details (name, email) via Google or Apple sign-in</li>
              <li>Tasks, lists, and content you create</li>
              <li>Usage data to improve the service</li>
              <li>
                Contacts, <strong className="text-white">only when you choose to import them</strong> —
                either from your device or from Google Contacts
              </li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-3">
              <strong className="text-white">About imported contacts.</strong>{" "}
              Contacts are other people&apos;s details, so we keep what we do with them narrow.
              They are used for one thing: suggesting people you might want to share a list
              with. We do not email them, we do not use them for advertising, and we never
              sell them. Contact names and phone numbers are encrypted at rest; email
              addresses are not encrypted, because we match on them to find existing
              {" "}{BRAND.appName} users. You can remove every contact you have imported at any
              time from Settings, which deletes them from our systems immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">How We Use It</h2>
            <ul className="list-disc list-inside text-gray-300 space-y-1 ml-2">
              <li>Provide, maintain, and improve {BRAND.appName}</li>
              <li>Process and store your tasks and content</li>
              <li>Send service-related communications</li>
              <li>Prevent fraud and abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Data Sharing</h2>
            <p className="text-gray-300 leading-relaxed mb-3">
              <strong>We do not sell your personal information.</strong>
            </p>
            <p className="text-gray-300 leading-relaxed">
              We share data only with infrastructure providers necessary to operate the service,
              when you explicitly share content with others, or when required by law.
            </p>
          </section>

          <section id="google-user-data" className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white mb-3">Google User Data</h2>
            <p className="text-gray-300 leading-relaxed mb-3">
              {BRAND.appName} requests two kinds of Google data, each only if you turn that
              feature on: <strong className="text-white">Google Tasks</strong>, and
              {" "}<strong className="text-white">Google Contacts</strong> (read-only). Both are
              covered by everything in this section, including the Limited Use commitment at
              the end of it.
            </p>
            <p className="text-gray-300 leading-relaxed mb-3">
              <strong className="text-white">Google Contacts.</strong>{" "}
              If you import contacts from Google, {BRAND.appName} reads your contact list
              (names, email addresses and phone numbers) once, with read-only access, solely
              to suggest people you might share a list with. We never write to your Google
              contacts. Clearing your imported contacts in Settings deletes them from our
              systems, and you can revoke the access itself at{" "}
              <a href="https://myaccount.google.com/permissions" className="text-blue-400 hover:underline">
                myaccount.google.com/permissions
              </a>.
            </p>
            <p className="text-gray-300 leading-relaxed mb-3">
              <strong className="text-white">Google Tasks.</strong>{" "}
              If you connect Google Tasks sync, {BRAND.appName} accesses your Google Tasks data
              (task lists, tasks, due dates, and completion status) solely to mirror
              tasks two-way between {BRAND.appName} and Google Tasks at your request. We do not
              use this data for advertising, we do not sell it, and no humans read it
              except with your explicit permission, for security purposes, or to comply
              with law. OAuth tokens are stored encrypted on our servers and are deleted
              when you disconnect the integration, which you can do at any time from
              Settings or at{" "}
              <a href="https://myaccount.google.com/permissions" className="text-blue-400 hover:underline">
                myaccount.google.com/permissions
              </a>.
            </p>
            <p className="text-gray-300 leading-relaxed mb-3">
              <strong className="text-white">How we protect Google user data.</strong>{" "}
              All Google user data is encrypted in transit (TLS 1.2+) and encrypted at rest in our
              database. OAuth access and refresh tokens are stored encrypted and are never exposed
              to the client or logged. Access is restricted to the automated sync service and to a
              small number of authorized personnel under strict access controls, only as needed for
              security or to comply with law. We never sell Google user data, use it for
              advertising, or share it with third parties.
            </p>
            <p className="text-gray-300 leading-relaxed mb-3">
              <strong className="text-white">Retention and deletion of Google user data.</strong>{" "}
              Google Tasks data mirrored into your {BRAND.appName} account is retained only while the Google
              Tasks integration is connected, and is kept in sync with your Google account. You can
              delete it at any time: disconnecting the integration (in Settings, or at{" "}
              <a href="https://myaccount.google.com/permissions" className="text-blue-400 hover:underline">
                myaccount.google.com/permissions
              </a>
              ) immediately deletes your stored OAuth tokens and stops all further access. Deleting
              your {BRAND.appName} account permanently removes all of your data, including any data
              synchronized from Google, from our systems. Backups containing this data are purged on
              a rolling 30-day cycle.
            </p>
            <p className="text-gray-300 leading-relaxed">
              {BRAND.appName}&apos;s use of information received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-blue-400 hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </section>

          <section id="github-data" className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white mb-3">GitHub Issues Sync</h2>
            <p className="text-gray-300 leading-relaxed mb-3">
              If you connect GitHub, you can mirror a list you choose between {BRAND.appName}
              {" "}and GitHub Issues. {BRAND.appName} accesses the repositories you select and
              the issues within them, solely to keep that list and those issues in step. We do
              not access repositories you have not connected, we do not read your source code,
              and we never sell this data or use it for advertising.
            </p>
            <p className="text-gray-300 leading-relaxed mb-3">
              <strong className="text-white">The sync runs on our servers, on a schedule.</strong>{" "}
              This is the part worth being explicit about, because it differs from Google Tasks:
              Google sync happens while you are using the app, whereas GitHub sync is performed
              by a scheduled job that runs <strong className="text-white">every 15 minutes</strong>.
              So while the integration is connected, {BRAND.appName} accesses GitHub on your
              behalf even when you are not using the app and no device of yours is running.
            </p>
            <p className="text-gray-300 leading-relaxed mb-3">
              <strong className="text-white">Credentials and disconnection.</strong>{" "}
              The connection is a GitHub App installation. The credentials that authorize it are
              stored encrypted on our servers and are never exposed to the client or written to
              logs. Disconnecting GitHub in Settings deletes them immediately and stops all
              further access; you can also remove the installation from GitHub itself, under
              your account&apos;s Applications settings.
            </p>
            <p className="text-gray-300 leading-relaxed">
              GitHub is a separate company with its own privacy policy, which governs the data
              once it reaches them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">If You Use None of This</h2>
            <p className="text-gray-300 leading-relaxed">
              Google Tasks sync, Google Contacts import, contact upload, and GitHub Issues sync
              are each optional and off until you turn them on. If you have never connected
              them, we hold none of the data described in those sections — no contacts, no
              GitHub credentials, and nothing mirrored from Google.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Infrastructure</h2>
            <p className="text-gray-300 leading-relaxed">
              Your data is stored securely using Neon (database) and Vercel (hosting).
              All data is encrypted in transit. Each provider maintains their own privacy
              practices which you can review independently.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Your Rights</h2>
            <ul className="list-disc list-inside text-gray-300 space-y-1 ml-2">
              <li>Access and update your account information</li>
              <li>Export your task data</li>
              <li>Delete your account and data</li>
              <li>Opt out of promotional emails</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">External Services</h2>
            <p className="text-gray-300 leading-relaxed">
              {BRAND.appName} integrates with Google and Apple for authentication, and — only
              if you turn them on — with Google Tasks, Google Contacts, and GitHub Issues.
              When you connect any of these services, their respective privacy policies apply
              to the data once it reaches them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p className="text-gray-300 leading-relaxed">
              Questions? Reach us at{" "}
              <a href={`mailto:privacy@${BRAND.domain}`} className="text-blue-400 hover:text-blue-300">
                privacy@{BRAND.domain}
              </a>
            </p>
          </section>
        </div>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center text-sm text-gray-400">
            <p>© {new Date().getFullYear()} Graceful Tools LLC</p>
            <div className="flex gap-6">
              <Link href="/terms" className="hover:text-white transition-colors">
                Terms of Service
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
