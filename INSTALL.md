Install parity on this machine, then stop.

Repository: https://github.com/aywalh/parity

The tool and the skill belong together: `bin/parity.mjs` does the work, and
`skills/parity/SKILL.md` is what tells an agent how to drive it. Install both.

1. Clone the repository into a directory the user names, or `./parity` if they
   name none.
2. Run `npm install` inside it.
3. Run `node bin/parity.mjs --install`. It prints what the environment is
   missing. If it reports Chromium as not downloaded, run
   `npx playwright install chromium`, then run setup again.
4. Install the skill, unless it is already available to you under the name
   `parity`:
   - If you support Claude Code plugins:

         /plugin marketplace add aywalh/parity
         /plugin install parity@parity

   - Otherwise register `skills/parity/SKILL.md` from the clone wherever your
     skills live. Read it from the file — do not retype or summarise it.
5. Verify both halves. `node bin/parity.mjs` with no arguments must list these
   commands: capture, localize, fetch, serve, verify, interact, responsive,
   motion, depth, diff, pxdiff, ui. And the skill must be available under the
   name `parity`. If either is missing, report what happened and stop.

Then tell the user where it was installed and hand them the first command:

    node bin/parity.mjs capture https://target.tld capture/orig

Do not reconstruct a site yet. Wait for the user to name one.
