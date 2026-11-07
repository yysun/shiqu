# Local release qualification

The 0.10.0 tag repeated the full JS suite on hosted CI and stopped before either installer build. Move that qualification to the existing local tag hook so release builds spend their time validating the platform artifacts.

- [ ] Each distinct version tag commit passes the complete JS plan in its isolated pre-push checkout before Git transfers the tag. Any failed suite prevents the push.
- [ ] Typecheck and lint run locally with the full JS plan. Tag Actions skip the JavaScript job and require both platform builds, native tests and installer smoke checks before publication.
- [ ] PR, main, manual and npm qualification retain their existing coverage. Full qualification keeps source and browser tests in separate batches to avoid resource contention.

This uses the installed Git hook as the local release gate. No tag, push, installer build or publication is part of this change.
