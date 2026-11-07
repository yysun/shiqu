# Local release qualification scenarios

1. With the release hook installed in a disposable checkout, push two version tags for the same commit to a temporary bare remote. A passing full plan runs once against the tagged snapshot and both refs arrive. Unrelated dirty files remain intact.
2. Repeat with a failing case outside the former release smoke subset. The full planner reaches that file, the push fails, no tag arrives, and the temporary worktree is removed.
3. Check the Desktop workflow for PR, main, tag and manual events. A tag runs native artifact qualification without the JavaScript job. A manual build still requires passing Shared checks, and either platform failure still blocks publication.
