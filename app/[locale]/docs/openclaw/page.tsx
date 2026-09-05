import { permanentRedirect } from 'next/navigation'

export default function OpenClawDocsRedirect() {
  permanentRedirect('/docs/custom-agents')
}
