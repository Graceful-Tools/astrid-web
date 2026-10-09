import { Suspense } from "react"
import { SignInContent } from "./signin-client"
import { scrollShellClassName } from "@/components/scroll-shell"

function LoadingFallback() {
  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
      <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Skeleton matching the real layout for smooth LCP */}
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="w-[88px] h-[88px] rounded-2xl theme-bg-tertiary animate-pulse" />
          <div className="text-left">
            <div className="h-10 w-28 theme-bg-tertiary rounded animate-pulse" />
            <div className="h-6 w-24 theme-bg-tertiary rounded animate-pulse mt-2" />
          </div>
        </div>
        <div className="h-12 w-48 mx-auto theme-bg-tertiary rounded-xl animate-pulse mb-8" />
        <div className="theme-surface border theme-border rounded-lg p-8">
          <div className="h-8 w-56 mx-auto theme-bg-tertiary rounded animate-pulse mb-6" />
          <div className="h-12 w-full theme-bg-tertiary rounded-xl animate-pulse mb-4" />
          <div className="h-12 w-full theme-bg-tertiary rounded-xl animate-pulse" />
        </div>
      </div>
      </div>
    </div>
  )
}

export default function SignIn() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SignInContent />
    </Suspense>
  )
}
