/**
 * The tail of Astrid's comic speech bubble, pointing left at her (AWTD-1615).
 * Place it inside a `relative` bubble with a 2px theme border; the shape lives
 * in styles/components.css (`.speech-bubble-tail`).
 */
export function SpeechBubbleTail() {
  return (
    <>
      <div aria-hidden="true" className="speech-bubble-tail border-r-theme" />
      <div aria-hidden="true" className="speech-bubble-tail speech-bubble-tail-fill speech-bubble-arrow-fill" />
    </>
  )
}
