# Generated image dimensions

Generated illustrations currently have inconsistent ratio instructions and no returned-dimension checks. New generation must request a consistent portrait format and reject unusable dimensions before writing media or updating the story.

- [x] Reader prompts and admin requests consistently specify 2:3 portrait, with a 1024 × 1536 target wherever pixel dimensions can be requested; Gemini retains its supported 2:3 / 1K settings.
- [x] PNG, JPEG and WebP returned dimensions are inspected before saving. Codex/admin minimum is 1024 × 1536; Gemini minimum is 832 × 1248 to accommodate native 1K output. At most 1% relative ratio deviation is accepted for native rounding.
- [x] Invalid, unreadable, square, landscape or undersized results fail without writing an image or changing existing page assets. Errors explain the dimension requirement.
- [x] Admin IMAGE_SIZE overrides must be 2:3 and at least 1024 × 1536; invalid configuration fails before a paid request. Valid larger overrides retain their requested minimum dimensions.
- [x] Existing images, reference-image loading, manual uploads, queue retry policy and the 12 MiB reader limit are preserved. Tests use controlled responses; no paid calls or builds.

Non-goals: resizing, cropping, re-encoding, complete pixel decoding, migration or regenerating existing images.
