## What this does

<!-- one or two sentences -->

## Closes

Closes #

## Verification — fill this in, do not delete it

- [ ] `pnpm verify` passes locally (typecheck + tests + web build)
- [ ] I added tests for the behaviour I changed, including at least one failure case
- [ ] I ran the end-to-end path this touches and it worked against a real (not stubbed) call
- [ ] No contract in `packages/core/src/contracts.ts` was widened without saying so in the channel
- [ ] No secrets, keys or `.env` in the diff
- [ ] No image bytes or personal data crossing a network boundary that should not

## How I tested it

<!-- the actual commands, and what you saw -->
