# Story/chapter picker E2E

Use an isolated temporary SQLite/media directory, bundled originals, and controlled provider responses.

1. Open new-story setup, choose direct source mode and Liaozhai. Search a story title, select it and submit. Observe the chosen title and production confirmation; verify saved original matches the range, discovery calls=0 and storyboard/image calls=0. Reload/resume and verify the same task/choice.
2. Choose a chapter book and search a chapter title. Choose Shishuo and verify individual anecdotes have chapter context. Book switches clear selection; delayed earlier responses cannot restore stale entries. Unavailable entries cannot be selected. At phone width verify no horizontal overflow and accessible labels/focus.
3. Inject a contents request failure, observe retry, then restore and retry. Search an absent term and observe empty state. Switch back to theme mode and verify its existing submission still creates discovery, with no retained direct source.
4. Replay direct creation and verify one task; change source under the same creation ID and expect conflict. Forged/stale/cross-book ranges fail before persistence. These API assertions may use the controlled integration suite.
