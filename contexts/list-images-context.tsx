'use client'

/**
 * One answer to "are list images drawn?" for the whole app — the
 * hide_list_images A/B test plus the user's "Show list images" override
 * (lib/list-images-visibility.ts).
 *
 * A provider, not a hook per consumer: useUserSettings() fetches on every
 * mount, and every sidebar row asks this question. Signed-out pages (public
 * lists) mount no settings bridge, so they make no settings request; with no
 * user the flag is off and images show.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useFeatureFlags } from '@/contexts/feature-flag-context'
import { useUserSettings } from '@/hooks/useUserSettings'
import {
  HIDE_LIST_IMAGES_FEATURE_KEY,
  shouldShowListImages,
} from '@/lib/list-images-visibility'

interface ListImagesVisibility {
  /** Effective: draw list images? */
  showListImages: boolean
  /** Store an explicit choice; it wins over the experiment from then on. */
  setShowListImages: (show: boolean) => void
}

const ListImagesContext = createContext<ListImagesVisibility>({
  showListImages: true,
  setShowListImages: () => {},
})

type Bridged = Pick<ReturnType<typeof useUserSettings>, 'updateSettings'> & {
  preference: boolean | null
}

/**
 * Mounted only when signed in, BESIDE the children rather than around them:
 * swapping the wrapper when the session resolves would remount the whole app.
 */
function UserSettingsBridge({ onChange }: { onChange: (bridged: Bridged) => void }) {
  const { settings, updateSettings } = useUserSettings()
  useEffect(() => {
    onChange({ preference: settings.showListImages, updateSettings })
  }, [settings.showListImages, updateSettings, onChange])
  return null
}

export function ListImagesProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  const { isEnabled } = useFeatureFlags()
  // No user, no arm: a signed-out page always shows images.
  const hideFlag = signedIn && isEnabled(HIDE_LIST_IMAGES_FEATURE_KEY)
  const [bridged, setBridged] = useState<Bridged | null>(null)

  const setShowListImages = useCallback(
    (show: boolean) => { void bridged?.updateSettings({ showListImages: show }) },
    [bridged],
  )
  const preference = signedIn ? bridged?.preference ?? null : null
  const value = useMemo(
    () => ({ showListImages: shouldShowListImages(preference, hideFlag), setShowListImages }),
    [preference, hideFlag, setShowListImages],
  )
  return (
    <ListImagesContext.Provider value={value}>
      {signedIn && <UserSettingsBridge onChange={setBridged} />}
      {children}
    </ListImagesContext.Provider>
  )
}

export function useListImagesVisibility(): ListImagesVisibility {
  return useContext(ListImagesContext)
}
