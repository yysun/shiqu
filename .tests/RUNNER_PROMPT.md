{{Runner Instructions | unbullet}}

Case: {{Case ID}} — {{Title}}
Objective: {{Objective | compact}}
Preconditions:
{{Preconditions}}
Test data:
{{Test Data}}
Expected outcomes:
{{Expected Outcome}}
Negative assertions:
{{Negative Assertions}}
Evidence required:
{{Evidence Required}}

Record a result for each branch exercised, including its DAG number when present. A case earns PASS only when this build meets every expected outcome and negative assertion with the required evidence. Document any unexecuted branch and its reason.

Return only:
Run Context: executed at | environment | build | data ID
Result: PASS | FAIL | BLOCKED | SKIPPED | INVALID
Conclusion: outcomes by branch
Evidence: durable path or URL
Issue / Reason: — for PASS; reason for every other result
