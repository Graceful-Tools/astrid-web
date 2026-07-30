"use client"

import { BRAND } from '@/lib/brand/config'
import { RefreshCw, LogOut, Trash2, Download, Settings, RotateCcw, Smartphone, Globe, ChevronRight } from "lucide-react"

interface HelpPageProps {
  onNavigate: (page: string) => void
}

export default function HelpPage({ onNavigate }: HelpPageProps) {
  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <h1 className="text-4xl font-bold text-white mb-2">Help & Troubleshooting</h1>
        <p className="text-gray-400 mb-10 text-lg">
          Most issues can be solved by refreshing your data. Try the simple solutions first before moving to more advanced steps.
        </p>

        {/* Quick Navigation */}
        <div className="flex flex-wrap gap-3 mb-10">
          <a href="#ios" className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
            <Smartphone className="w-4 h-4" />
            iOS App
          </a>
          <a href="#web" className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
            <Globe className="w-4 h-4" />
            Web App
          </a>
        </div>

        {/* iOS Section */}
        <section id="ios" className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Smartphone className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">iOS App</h2>
          </div>

          <div className="space-y-6">
            {/* Simple */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 bg-green-600/20 text-green-400 text-xs font-semibold rounded">SIMPLE</span>
                <span className="text-gray-400 text-sm">Try these first</span>
              </div>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">1</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Pull to Refresh</h3>
                    <p className="text-gray-400 text-sm">On the task list, pull down from the top to force a sync with the server. This fixes most sync issues.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">2</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Force Quit and Reopen</h3>
                    <p className="text-gray-400 text-sm">Swipe up from the bottom (or double-tap home button), swipe {BRAND.appName} away, then reopen the app.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Intermediate */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 text-xs font-semibold rounded">INTERMEDIATE</span>
                <span className="text-gray-400 text-sm">If simple steps don&apos;t work</span>
              </div>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">3</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Sign Out and Sign Back In</h3>
                    <p className="text-gray-400 text-sm">Go to <strong>Settings</strong> (tap your profile in the sidebar) &rarr; <strong>Account</strong> &rarr; <strong>Sign Out</strong>. Then sign back in with the same account.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">4</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Check Your Internet Connection</h3>
                    <p className="text-gray-400 text-sm">{BRAND.appName} works offline but needs internet to sync. Make sure you&apos;re connected to WiFi or cellular data.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 bg-red-600/20 text-red-400 text-xs font-semibold rounded">ADVANCED</span>
                <span className="text-gray-400 text-sm">Last resort options</span>
              </div>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">5</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Delete and Reinstall the App</h3>
                    <p className="text-gray-400 text-sm">This clears all local data and cache. Your tasks are stored on our servers, so you won&apos;t lose anything. Press and hold the app icon &rarr; Remove App &rarr; Delete App, then reinstall from the App Store.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">6</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Restart Your Device</h3>
                    <p className="text-gray-400 text-sm">Sometimes a full device restart can resolve persistent issues.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Web Section */}
        <section id="web" className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-600 rounded-lg">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">Web App</h2>
          </div>

          <div className="space-y-6">
            {/* Simple */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 bg-green-600/20 text-green-400 text-xs font-semibold rounded">SIMPLE</span>
                <span className="text-gray-400 text-sm">Try these first</span>
              </div>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">1</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Refresh the Page</h3>
                    <p className="text-gray-400 text-sm">Press <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs">F5</kbd> or <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs">Cmd+R</kbd> (Mac) / <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs">Ctrl+R</kbd> (Windows) to reload the page.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">2</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Hard Refresh</h3>
                    <p className="text-gray-400 text-sm">Hold <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs">Shift</kbd> while clicking refresh, or press <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs">Cmd+Shift+R</kbd> (Mac) / <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs">Ctrl+Shift+R</kbd> (Windows). This bypasses the cache.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Intermediate */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 text-xs font-semibold rounded">INTERMEDIATE</span>
                <span className="text-gray-400 text-sm">If simple steps don&apos;t work</span>
              </div>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">3</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Sign Out and Sign Back In</h3>
                    <p className="text-gray-400 text-sm">Click your profile picture in the sidebar &rarr; <strong>Settings</strong> &rarr; <strong>Account</strong> &rarr; <strong>Sign Out</strong>. Then sign back in.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">4</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Try a Different Browser</h3>
                    <p className="text-gray-400 text-sm">If you&apos;re having issues in one browser, try Chrome, Firefox, Safari, or Edge. This helps identify if it&apos;s a browser-specific issue.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">5</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Disable Browser Extensions</h3>
                    <p className="text-gray-400 text-sm">Ad blockers or privacy extensions can sometimes interfere. Try disabling them temporarily or use an incognito/private window.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 bg-red-600/20 text-red-400 text-xs font-semibold rounded">ADVANCED</span>
                <span className="text-gray-400 text-sm">Last resort options</span>
              </div>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">6</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Clear Browser Cache and Cookies for {BRAND.appName}</h3>
                    <p className="text-gray-400 text-sm">
                      <strong>Chrome:</strong> Settings &rarr; Privacy &rarr; Clear browsing data &rarr; Select &quot;Cookies&quot; and &quot;Cached images&quot;<br />
                      <strong>Safari:</strong> Preferences &rarr; Privacy &rarr; Manage Website Data &rarr; Search for &quot;astrid&quot; &rarr; Remove<br />
                      <strong>Firefox:</strong> Settings &rarr; Privacy &rarr; Clear Data &rarr; Select Cookies and Cache
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-sm font-bold">7</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Clear IndexedDB Storage</h3>
                    <p className="text-gray-400 text-sm">
                      In Chrome: Open DevTools (F12) &rarr; Application tab &rarr; Storage &rarr; IndexedDB &rarr; Right-click astrid entries &rarr; Delete database. Then refresh the page.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Common Issues */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-6">Common Issues</h2>

          <div className="space-y-4">
            <details className="group bg-gray-900 border border-gray-800 rounded-xl">
              <summary className="flex items-center justify-between p-4 cursor-pointer">
                <span className="font-medium text-white">Task counts showing 0 or wrong numbers</span>
                <ChevronRight className="w-5 h-5 text-gray-400 group-open:rotate-90 transition-transform" />
              </summary>
              <div className="px-4 pb-4 text-gray-400 text-sm">
                <p>Task counts are calculated from your synced data. If counts seem wrong:</p>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>Pull to refresh (iOS) or hard refresh the page (web)</li>
                  <li>Wait a few seconds for the sync to complete</li>
                  <li>If still incorrect, sign out and sign back in</li>
                </ol>
              </div>
            </details>

            <details className="group bg-gray-900 border border-gray-800 rounded-xl">
              <summary className="flex items-center justify-between p-4 cursor-pointer">
                <span className="font-medium text-white">Tasks not syncing between devices</span>
                <ChevronRight className="w-5 h-5 text-gray-400 group-open:rotate-90 transition-transform" />
              </summary>
              <div className="px-4 pb-4 text-gray-400 text-sm">
                <p>Syncing happens automatically but can take a few seconds. To force a sync:</p>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>Make sure both devices are connected to the internet</li>
                  <li>On iOS: Pull down to refresh</li>
                  <li>On web: Refresh the page</li>
                  <li>Changes should appear within 5-10 seconds</li>
                </ol>
              </div>
            </details>

            <details className="group bg-gray-900 border border-gray-800 rounded-xl">
              <summary className="flex items-center justify-between p-4 cursor-pointer">
                <span className="font-medium text-white">App is slow or unresponsive</span>
                <ChevronRight className="w-5 h-5 text-gray-400 group-open:rotate-90 transition-transform" />
              </summary>
              <div className="px-4 pb-4 text-gray-400 text-sm">
                <p>Performance issues are usually caused by cached data or too many browser tabs. Try:</p>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>Close other tabs and applications</li>
                  <li>Force quit and reopen the app (iOS)</li>
                  <li>Clear browser cache (web)</li>
                  <li>Reinstall the app if issues persist (iOS)</li>
                </ol>
              </div>
            </details>

            <details className="group bg-gray-900 border border-gray-800 rounded-xl">
              <summary className="flex items-center justify-between p-4 cursor-pointer">
                <span className="font-medium text-white">Can&apos;t sign in or getting authentication errors</span>
                <ChevronRight className="w-5 h-5 text-gray-400 group-open:rotate-90 transition-transform" />
              </summary>
              <div className="px-4 pb-4 text-gray-400 text-sm">
                <p>Authentication issues can happen due to expired sessions or browser settings:</p>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>Make sure cookies are enabled in your browser</li>
                  <li>Try signing in with an incognito/private window</li>
                  <li>Clear cookies for {BRAND.domain} specifically</li>
                  <li>If using a passkey, make sure your device supports it</li>
                </ol>
              </div>
            </details>
          </div>
        </section>

        {/* Still Need Help */}
        <section className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-gray-800 rounded-xl p-6 text-center">
          <h2 className="text-xl font-bold text-white mb-2">Still Need Help?</h2>
          <p className="text-gray-400 mb-4">
            If none of these solutions work, we&apos;re here to help.
          </p>
          <a
            href={`mailto:${BRAND.supportEmail}`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors"
          >
            Contact Support
          </a>
        </section>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center text-sm text-gray-400">
            <p>&copy; {new Date().getFullYear()} Graceful Tools LLC</p>
            <div className="flex gap-6">
              <button onClick={() => onNavigate('terms')} className="hover:text-white transition-colors">
                Terms of Service
              </button>
              <button onClick={() => onNavigate('privacy')} className="hover:text-white transition-colors">
                Privacy Policy
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
