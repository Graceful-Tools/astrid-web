"use client"

interface PrivacyPageProps {
  onNavigate: (page: string) => void
}

export default function PrivacyPage({ onNavigate }: PrivacyPageProps) {
  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-500 mb-10">Last updated: January 3, 2026</p>

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
            <p>&copy; {new Date().getFullYear()} Graceful Tools LLC</p>
            <div className="flex gap-6">
              <button onClick={() => onNavigate('terms')} className="hover:text-white transition-colors">
                Terms of Service
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
