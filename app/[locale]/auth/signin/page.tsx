import { Suspense } from "react"
import { SignInContent } from "./signin-client"
import { scrollShellClassName } from "@/components/scroll-shell"

function LoadingFallback() {
  return (
    <div className={`${scrollShellClassName} bg-black`}>
      <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Skeleton matching the real layout for smooth LCP */}
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="w-[88px] h-[88px] rounded-2xl bg-gray-800 animate-pulse" />
          <div className="text-left">
            <div className="h-10 w-28 bg-gray-800 rounded animate-pulse" />
            <div className="h-6 w-24 bg-gray-800 rounded animate-pulse mt-2" />
          </div>
        </div>
        <div className="h-12 w-48 mx-auto bg-gray-800 rounded-xl animate-pulse mb-8" />
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8">
          <div className="h-8 w-56 mx-auto bg-gray-800 rounded animate-pulse mb-6" />
          <div className="h-12 w-full bg-gray-800 rounded-xl animate-pulse mb-4" />
          <div className="h-12 w-full bg-gray-800 rounded-xl animate-pulse" />
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
