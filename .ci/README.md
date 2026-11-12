# Own runner validation

Run `mise run check` before pushing; the installed pre-push hook validates workflow syntax, shell scripts, and static L3 routing. All CI jobs use `l3-ubuntu-26.04` with `CI_PROVIDER=l3`.

Repository Actions must be enabled before pushing the branch. Enabling Actions does not replay earlier pull request events: push a reviewed change and verify the run uses the exact new commit. The native, sanitizer, Meson, documentation, headers, i386, and WASM builds require actual CI results; syntax validation alone does not establish that these builds pass. Keep the migration pull request in draft until that evidence is available.

The i386 Meson tests explicitly exercise `io_method=io_uring`. Docker's default
seccomp profile denies the required syscalls, causing `initdb` to fail with
`could not setup io_uring queue: Operation not permitted` before regression tests
can run. `docker-seccomp-io-uring.json` retains the upstream Docker profile from
[moby/profiles at 6049e40058759e8a1673ac1090ec6a7e36b9c9bd](https://github.com/moby/profiles/blob/6049e40058759e8a1673ac1090ec6a7e36b9c9bd/seccomp/default.json)
and adds only `io_uring_setup`, `io_uring_enter`, and `io_uring_register` to its
allowlist. Its Apache 2.0 license is preserved in `docker-seccomp-LICENSE`.
Keep the tests unprivileged and the remaining syscall restrictions enabled.
