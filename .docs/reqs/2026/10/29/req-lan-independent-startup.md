# LAN must survive internet startup failure

The installed Lite app loses its browser link when internet access is enabled but cloudflared is unavailable. Optional remote access must not prevent local reading. LAN never requires a pairing ID; only public HTTPS access does.

## Acceptance
- [x] Starting with internet enabled and a missing/failed helper returns a running local/LAN reader, a normal browser URL and LAN links with no fragment or pairing cookie. A safe internet-only error is visible and no public URL is advertised.
- [x] Failed remote startup revokes/closes the remote entry and cleans its helper/config; explicit stop releases the local port and data ownership. Parent EOF/abort during startup still stops everything. Port/data ownership failures still fail full startup.
- [x] The installed Lite app retains “在浏览器打开” after missing-helper startup; LAN wording explicitly says no pairing ID is required. README clearly separates LAN from internet pairing and uses an updated desktop screenshot.
- [x] Focused lifecycle/auth tests, type/lint checks and browser UI evidence verify the change. Lite is rebuilt/installed/launched under the earlier explicit build/install/run request; no paid AI calls, new helper installation, Docker build or public exposure of the personal library.
