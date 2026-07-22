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
            <Image src="/icons/icon-96x96.png" alt="Astrid" width={32} height={32} className="rounded" />
            <span className="text-2xl font-bold text-white">astrid</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-500 mb-10">Last updated: July 18, 2026</p>

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
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">How We Use It</h2>
            <ul className="list-disc list-inside text-gray-300 space-y-1 ml-2">
              <li>Provide, maintain, and improve Astrid</li>
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
              If you connect Google Tasks sync, Astrid accesses your Google Tasks data
              (task lists, tasks, due dates, and completion status) solely to mirror
              tasks two-way between Astrid and Google Tasks at your request. We do not
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
              Google Tasks data mirrored into your Astrid account is retained only while the Google
              Tasks integration is connected, and is kept in sync with your Google account. You can
              delete it at any time: disconnecting the integration (in Settings, or at{" "}
              <a href="https://myaccount.google.com/permissions" className="text-blue-400 hover:underline">
                myaccount.google.com/permissions
              </a>
              ) immediately deletes your stored OAuth tokens and stops all further access. Deleting
              your Astrid account permanently removes all of your data, including any data
              synchronized from Google, from our systems. Backups containing this data are purged on
              a rolling 30-day cycle.
            </p>
            <p className="text-gray-300 leading-relaxed">
              Astrid&apos;s use of information received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-blue-400 hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
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
              Astrid integrates with Google and Apple for authentication.
              When you connect these services, their respective privacy policies apply.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p className="text-gray-300 leading-relaxed">
              Questions? Reach us at{" "}
              <a href="mailto:privacy@astrid.cc" className="text-blue-400 hover:text-blue-300">
                privacy@astrid.cc
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
