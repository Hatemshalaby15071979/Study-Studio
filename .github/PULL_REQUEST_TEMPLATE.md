## What this changes

<!-- What does this pull request do, and why? Link the issue it closes. -->

## How it was verified

<!--
The checks that ran, and what they showed. "The CI is green" is not a
verification — name the check and what it proved.

For a change that touches the Helix Core sidecar, say which Helix-Education
commit the sidecar was built from and that the contract test ran against the
real binary.
-->

- [ ] The tests that cover this pass, and I have run them locally.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint:ci` passes (no new warnings).
- [ ] `npm run check:coverage` passes, and coverage did not drop.
- [ ] `npm run check:versions` passes, if any version manifest changed.
- [ ] `npm run check:release` passes, if a version or the CHANGELOG changed.

## Notes for the reviewer

<!--
Anything that is hard to see in the diff: a trade-off made, a risk taken,
something deliberately left out and why.
-->
