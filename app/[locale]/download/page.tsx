import { BRAND } from '@/lib/brand/config'
import Link from "next/link"
import Image from "next/image"
import { ScrollShell } from "@/components/scroll-shell"

export const metadata = {
  title: `Download ${BRAND.appName} for Mac`,
  description: `${BRAND.appName} for Mac — a native desktop app for your tasks, lists, and chat.`,
}

// The DMG lives on GitHub Releases (free bandwidth, versioned). We resolve the newest
// release at request time so publishing a release is the only step needed to ship an update.
const REPO = "Graceful-Tools/astrid-ios"
const LATEST_FALLBACK = `https://github.com/${REPO}/releases/latest`

type MacRelease = { version: string; url: string; size: string; published: string } | null

async function getLatestMacRelease(): Promise<MacRelease> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 900 }, // 15 min — releases are rare, don't hammer the API
    })
    if (!res.ok) return null
    const releases = await res.json()
    for (const rel of releases) {
      if (rel.draft || !String(rel.tag_name).startsWith("mac-")) continue
      const asset = (rel.assets || []).find((a: { name: string }) => a.name.endsWith(".dmg"))
      if (!asset) continue
      return {
        version: String(rel.tag_name).replace(/^mac-v?/, ""),
        url: asset.browser_download_url,
        size: `${(asset.size / 1_048_576).toFixed(0)} MB`,
        published: new Date(rel.published_at).toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        }),
      }
    }
    return null
  } catch {
    return null
  }
}

export default async function DownloadPage() {
  const mac = await getLatestMacRelease()

  return (
    <ScrollShell className="bg-black text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="container mx-auto px-4 py-6">
          <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={32} height={32} className="rounded" />
            <span className="text-2xl font-bold text-white">{BRAND.wordmark}</span>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-4xl font-bold text-white mb-2">Download {BRAND.appName}</h1>
        <p className="text-gray-400 mb-10">
          Native apps that stay in sync with everything you have on the web.
        </p>

        {/* Mac */}
        <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">{BRAND.appName} for Mac</h2>
              <p className="text-gray-400 text-sm">
                {mac
                  ? `Version ${mac.version} · ${mac.size} · Released ${mac.published}`
                  : "Universal · macOS 14 Sonoma or later"}
              </p>
            </div>
            <a
              href={mac?.url ?? LATEST_FALLBACK}
              className="inline-flex items-center rounded-lg bg-white px-5 py-2.5 font-semibold text-black transition-opacity hover:opacity-90"
            >
              {mac ? "Download for Mac" : "View releases"}
            </a>
          </div>
          <ul className="mt-5 grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
            <li>• Menu-bar quick add and global hotkey</li>
            <li>• Board, list, and calendar views</li>
            <li>• Works offline, syncs when you reconnect</li>
            <li>• Apple Reminders and Calendar integration</li>
          </ul>
          <p className="mt-5 text-xs text-gray-500">
            Open the DMG and drag {BRAND.appName} to your Applications folder. The app is signed and
            notarized by Apple, so it opens without extra steps. macOS 14 or later.
          </p>
        </section>

        {/* iPhone & iPad */}
        <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">{BRAND.appName} for iPhone &amp; iPad</h2>
              <p className="text-gray-400 text-sm">Currently in TestFlight beta</p>
            </div>
            <a
              href="https://testflight.apple.com/join/V11WpM3d"
              className="inline-flex items-center rounded-lg border border-gray-700 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-gray-800"
            >
              Join the beta
            </a>
          </div>
        </section>

        <p className="mt-10 text-sm text-gray-500">
          Prefer the browser?{" "}
          <Link href="/" className="text-white underline underline-offset-4 hover:opacity-80">
            Use {BRAND.appName} on the web
          </Link>
          .
        </p>
      </main>
    </ScrollShell>
  )
}
