# Node React migration E2E

1. Fresh data: with no key and empty mounted directory, start Node and Docker. /api/stories returns the sample; / and /read?id=<sample> render; sample images and original are available; /api/reader/status reports generation unavailable.
2. Persistence: save sample progress, create a mocked generated session and media, soft-delete and restore. Restart against same directory. Rows, media bytes, source, progress and deletion state survive; seed never overwrites edits.
3. Generation: mocked delayed Gemini planning/image requests acquire one SQL checkpoint under duplicate advances. Retry cooldown, manual retry and stale-lock recovery keep current behavior. No real Gemini request.
4. HTTP boundary: supplied identity headers cannot change local owner; cross-origin mutations fail; traversal, data/.env and unknown API routes do not expose files or return SPA HTML. Upload and read media with correct MIME. /read deep-link refresh renders SPA.
5. Legacy conversion: import a stopped fixture containing real-layout D1/R2 records and metadata/blob files into a new directory, verify all expected tables, source JSON and media bytes; source unchanged. Invalid or incomplete blob data leaves no successful target. Existing target refused.
6. Bind mounts: default Compose uses ./data. Override to a path containing spaces with test host UID/GID on Linux, write progress/media, recreate container, verify host-visible SQLite/media and retained values. Container runs non-root. Stop before folder backup; restore copy starts with same data.
7. Browser: in-app browser production UI opens, reads sample, flips pages, opens source and settings, exports PDF, returns home, reloads a deep link. Assert no relevant console/network failures. Inspect desktop and narrow viewport.
