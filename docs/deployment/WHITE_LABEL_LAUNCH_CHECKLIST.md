# White-label launch checklist

Use this page as the operator's launch sequence. It links to the detailed guides rather
than replacing them. The supported boundary is one customer organization per deployment;
shared multi-organization tenancy and per-organization identity lifecycle features are
partner-built, not shipped. See [Project Mode](../product/PROJECT_MODE.md) and
[Whitelabeling](../WHITELABELING.md#deployment-and-tenancy-boundary).

## Required for every deployment

- [ ] **Create and verify the brand profile.** Set the deployment identity and capabilities,
  then run `npm run check:brands`. Follow [Whitelabeling](../WHITELABELING.md) and
  [Brand Profiles](../../brands/README.md).
- [ ] **Choose the deployment and configure its domain.** Point DNS to the chosen host,
  enable HTTPS, and set the public URL and callback URLs to that exact origin. Use
  [Self-hosting](./SELF_HOSTING.md) for Docker/Compose or [Azure](./AZURE.md) for Azure
  Container Apps; hosted Vercel has its own [setup guide](../setup/VERCEL_SETUP.md).
- [ ] **Own and configure sign-in applications.** Register and maintain the OAuth/OIDC
  applications used by this brand, and set their callback URLs for the deployed domain.
  See [Whitelabeling — sign-in providers](../WHITELABELING.md#sign-in-providers).
- [ ] **Verify outbound mail identity.** Configure the sender address and ensure the
  selected mail provider is authorized to send for its domain. See
  [Email Setup](../setup/EMAIL_SETUP.md), [Self-hosting — email](./SELF_HOSTING.md#email),
  or [Azure](./AZURE.md).
- [ ] **Back up the database and encryption key together.** Also back up uploaded objects
  using the selected storage provider's retention or backup facilities. Without the
  encryption key, encrypted database values cannot be read. See
  [Self-hosting — upgrades](./SELF_HOSTING.md#upgrades) or
  [Azure — backups and restore](./AZURE.md#backups-and-restore).
- [ ] **Probe the live deployment.** Confirm `GET /api/health` reports healthy and the
  expected commit, then check `GET /api/v1/capabilities` for the brand and enabled sign-in
  methods. Run the deployment's documented smoke test where available:
  [Self-host smoke test](../../scripts/self-host-smoke.ts).

## Optional or conditional setup

- [ ] **Web push (optional):** configure the VAPID key pair if browser push notifications
  are part of the launch. The public key is build-time configuration; see
  [Self-hosting](./SELF_HOSTING.md#your-brand-goes-in-at-build-time) and the
  [environment registry](../../lib/env.ts).
- [ ] **Native apps (optional):** if shipping branded mobile/desktop apps, build and sign
  each platform variant and prepare its store listing. Follow the platform steps in
  [Whitelabeling — native apps](../WHITELABELING.md#native-apps-per-platform) and each
  platform's own release guide.
- [ ] **Azure field verification (conditional):** Azure is documented, **not
  field-verified**. The Bicep template has not been run against a real subscription; use
  [Azure — status and remaining checks](./AZURE.md#still-to-do) before relying on it.
