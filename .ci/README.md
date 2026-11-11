# Own runner validation

Run `mise run check` before pushing; the installed pre-push hook validates workflow syntax, shell scripts, and static L3 routing. All CI jobs use `l3-ubuntu-26.04` with `CI_PROVIDER=l3`.

Repository Actions must be enabled before pushing the branch. Enabling Actions does not replay earlier pull request events: push a reviewed change and verify the run uses the exact new commit. The native, sanitizer, Meson, documentation, headers, i386, and WASM builds require actual CI results; syntax validation alone does not establish that these builds pass. Keep the migration pull request in draft until that evidence is available.
