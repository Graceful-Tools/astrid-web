import { BRAND } from '@/lib/brand/config'

/**
 * The Terms of Service, written once (AWTD-1584). The public /terms page and the in-app
 * Settings page both render this, so the two can no longer drift apart, which they had: the
 * in-app copy was months older. Legal text: change the wording here deliberately, and bump
 * the date. The operator is `BRAND.operatorName`, never a literal company.
 */
export function TermsOfServiceContent() {
  return (
    <>
      <h1 className="text-4xl font-bold theme-text-primary mb-2">Terms of Service</h1>
      <p className="theme-text-muted mb-10">Last updated: January 3, 2026</p>

      <div className="space-y-10">
        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">The Service</h2>
          <p className="theme-text-secondary leading-relaxed">
            {BRAND.appName} is a task management application operated by {BRAND.operatorName}.
            By using {BRAND.appName}, you agree to these terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Your Account</h2>
          <p className="theme-text-secondary leading-relaxed">
            You&apos;re responsible for your account security and all activity under it.
            Keep your credentials safe and notify us of any unauthorized access.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Your Content</h2>
          <p className="theme-text-secondary leading-relaxed">
            You own everything you create in {BRAND.appName}. We only use your content to
            provide the service—storing, syncing, and displaying it back to you.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Acceptable Use</h2>
          <p className="theme-text-secondary leading-relaxed mb-3">
            Don&apos;t use {BRAND.appName} to:
          </p>
          <ul className="list-disc list-inside theme-text-secondary space-y-1 ml-2">
            <li>Break any laws</li>
            <li>Harass or harm others</li>
            <li>Distribute malware or spam</li>
            <li>Attempt to access others&apos; accounts</li>
            <li>Interfere with the service</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">External Services</h2>
          <p className="theme-text-secondary leading-relaxed">
            {BRAND.appName} connects with Google and Apple for sign-in. When using these
            integrations, their respective terms apply.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Service Changes</h2>
          <p className="theme-text-secondary leading-relaxed">
            We may modify or discontinue features at any time. We&apos;ll try to give
            notice for significant changes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Warranty Disclaimer</h2>
          <p className="theme-text-secondary leading-relaxed">
            {BRAND.appName} is provided &quot;as is&quot; without warranties of any kind. We don&apos;t
            guarantee uptime, accuracy, or that the service will meet your specific needs.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Limitation of Liability</h2>
          <p className="theme-text-secondary leading-relaxed">
            To the extent permitted by law, {BRAND.operatorName} isn&apos;t liable for
            indirect damages, data loss, or service interruptions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Termination</h2>
          <p className="theme-text-secondary leading-relaxed">
            You can delete your account anytime. We may suspend accounts that
            violate these terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold theme-text-primary mb-3">Contact</h2>
          <p className="theme-text-secondary leading-relaxed">
            Questions? Reach us at{" "}
            <a href={`mailto:legal@${BRAND.domain}`} className="text-brand hover:text-brand-hover">
              legal@{BRAND.domain}
            </a>
          </p>
        </section>
      </div>
    </>
  )
}
