# Cloudflare Proxy in Front of Vercel

`astrid.cc` DNS is hosted on Cloudflare (nameservers, Email Routing, the `claw`
tunnel). The app itself runs on Vercel. This page records which hosts go
through Cloudflare's proxy (orange cloud), why, what the app does about it, and
how to undo it.

## Decision (2026-09-13)

**Proxy every Vercel-served host**, not just the apex. Before this date
`astrid.cc` and `www` were proxied while `staging.astrid.cc` and the
`*.astrid.cc` preview wildcard were DNS-only, so staging could never reproduce
Cloudflare-specific behaviour and production rate limits were silently broken
(see below). The two consistent end states were "proxy everything" or "proxy
nothing"; we chose proxy for the WAF/DDoS layer, with "proxy nothing" as the
documented rollback if it causes trouble.

| Record | Type | Target | Proxy |
|---|---|---|---|
| `astrid.cc` | A | `76.76.21.21` | on |
| `www.astrid.cc` | A | `76.76.21.21` | on |
| `staging.astrid.cc` | CNAME | `<hash>.vercel-dns-016.com` | on |
| `*.astrid.cc` | A | `76.76.21.21` | on |
| `claw.astrid.cc` | CNAME | `<id>.cfargotunnel.com` | on (tunnel; must stay on) |
| MX / TXT / CAA | — | — | not proxyable |

Cloudflare zone settings that must hold for any proxied host:

- **SSL/TLS mode: Full (strict).** Vercel holds a valid Let's Encrypt cert per
  hostname, so strict works. "Flexible" causes a redirect loop with Vercel.
- **Rocket Loader, Auto Minify, Email Address Obfuscation, Mirage: off.** Each
  rewrites HTML and breaks Next.js hydration.
- **Leave CAA alone.** Cloudflare adds its own CA entries at the edge for
  Universal SSL; the dashboard's `letsencrypt.org` entry is what Vercel needs.

## What the app does about it

Vercel **overwrites** `X-Forwarded-For` with the peer that connected to it. Behind
the proxy that peer is a Cloudflare edge, so every IP-keyed rate limit (OAuth
token, Google/Apple sign-in, invitations, public tasks, agent webhooks) was
bucketing all users into a handful of Cloudflare addresses.

`lib/client-ip.ts` fixes this: when the trusted hop is inside Cloudflare's
published IPv4 ranges it returns `cf-connecting-ip`; otherwise it ignores that
header, so a caller reaching Vercel directly cannot forge it. `TRUSTED_PROXY_DEPTH`
stays at `1`. The range list is a snapshot of <https://www.cloudflare.com/ips-v4>;
refresh it if limits start keying on `104.x`/`172.x` addresses again.

## Known consequences of proxying

- **Origin timeout: 100 s.** Cloudflare returns a 524 if Vercel has not sent
  response headers within 100 s. `vercel.json` caps API routes at 30 s and
  `github-sync` at 60 s; the SSE route streams headers immediately. Keep any new
  `maxDuration` under 100 s or exempt the route.
- **Error pages.** Cloudflare replaces raw 5xx bodies with its own page. The
  OAuth integration callbacks already render a human-readable failure page for
  this reason.
- **Undeployed preview hosts return a Cloudflare 526** instead of a browser
  certificate warning. Vercel still cannot issue a `*.astrid.cc` wildcard cert
  (it needs DNS-01, and DNS is on Cloudflare), so a `<alias>.astrid.cc` host
  only works once that alias has been deployed. Deploy before you share a URL.
- **Cloudflare cache.** Vercel sends `cache-control: public, max-age=0,
  must-revalidate` to clients, so Cloudflare does not cache HTML. Do not add
  Cache Rules that override this for `/api/*` or app pages.

## Rollback: proxy nothing

If the proxy causes trouble, turn the orange cloud **off** on `astrid.cc`,
`www`, `staging` and `*` (never on `claw`). Nothing else changes: Vercel already
holds origin certs for every deployed host, `lib/client-ip.ts` falls back to the
plain peer address when the hop is not Cloudflare, and email routing is
unaffected because MX records are never proxied. Vercel's own guidance prefers
this DNS-only mode; the trade is losing Cloudflare's WAF/DDoS layer.

## Related

- [CLOUDFLARE_EMAIL_SETUP.md](./CLOUDFLARE_EMAIL_SETUP.md) — inbound mail via
  Email Routing (the reason Cloudflare hosts the zone at all).
- [CLOUDFLARE_RESEND_STATUS.md](./CLOUDFLARE_RESEND_STATUS.md) — SPF/DKIM state.
