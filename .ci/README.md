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

Both Meson jobs permit locked memory for io_uring queues. The native job raises
only its test shell's inherited memlock limit with `prlimit`; the i386 container
sets its memlock limit through Docker. The native failure artifact showed 48
io_uring queue initialization failures with `Cannot allocate memory` while other
tests passed. This is consistent with insufficient locked-memory allowance;
the actual rerun must verify the resource fix. Failed native LDAP setup also
prints configuration validation and relevant AppArmor denials for diagnosis.

Native Meson and autoconf artifacts confirmed AppArmor denying `slapd` access to
the generated `slapd.conf`. Dependency setup retains Ubuntu's confinement and
adds owner-only read/write/lock access for the four LDAP TAP fixture directories
through its local profile include. It reloads the existing profile; it does not
disable AppArmor or put the daemon in complain mode.

The i386 container uses Docker's `--init` to reap orphaned test postmasters.
The shared-memory recovery test deliberately kills its postmaster; without a
reaper, the artifact showed the killed PID still blocking startup and shutdown.
The complete suite, including that recovery test, must pass on the new commit.
