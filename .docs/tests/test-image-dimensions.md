# Image dimension boundary scenarios

1. With controlled Codex and Gemini providers and empty storage, generate a valid portrait result. Inspect outbound ratio/size instructions, saved MIME/extension and returned asset. Repeat with wrong ratio, too-small and truncated results: fail with no new asset.
2. With a queued reader story ready for images, return wrong dimensions. Observe failed image job and unchanged page asset, no repeated call from passive demand; explicit retry with a valid portrait succeeds.
3. With a seeded admin draft and controlled transport, generate using default and valid larger IMAGE_SIZE; verify outbound size/2:3 instructions and actual saved MIME. Invalid override must make zero transport calls. Invalid returned dimensions fail the job, preserve the page/revision and write no media. Cover both inline bytes and downloaded image response.
4. Existing saved images/reference loading and manual upload contracts continue through existing suites; run without real inference or image generation.
