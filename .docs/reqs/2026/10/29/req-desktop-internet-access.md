# Desktop internet access

LAN remains available whenever the desktop reader runs. Replace its opt-in checkbox with optional internet access, so a phone on cellular or another network can scan a public HTTPS link to the same local library.

## Acceptance
- [x] LAN stays on without a toggle; local browser and LAN retain direct shared-library access.
- [x] Internet access defaults off, including migration from old lanEnabled settings. It uses a free, accountless Cloudflare Quick Tunnel when enabled; no domain or paid service required.
- [ ] Desktop displays a public HTTPS QR/pairing link and copy action after tunnel startup; local/LAN addresses remain available. Explain changing URLs, computer uptime, helper setup and free-service limits.
- [x] Public reader, API and media require a cryptographically random pairing link/session; native configuration stays inaccessible. Cross-origin writes and unpaired public access are denied.
- [x] Stop/exit/parent EOF revoke sessions, stop the helper and release listeners/ownership; missing helper, startup failure and helper exit do not leave a misleading public QR or unprotected listener.
- [ ] Existing library data, provider configuration and generation behavior remain unchanged, with appropriate automated checks and in-app-browser verification.

## Constraints and non-goals
Use Node/pnpm pinned by repository. No Docker builds, desktop preparation, bundling, packaging, paid AI generation, production deployment, automatic helper installation, permanent domain, multi-user accounts or changes to development-server LAN behavior. Both editions use separately installed cloudflared, with PATH/common-location discovery and optional absolute executable path. LAN remains trusted-network HTTP and shared full permissions. Anyone with the complete private pairing link can access shared library/generation until service stop; the bare public hostname cannot. No blocking questions.
