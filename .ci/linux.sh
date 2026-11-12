#!/usr/bin/env bash
set -euo pipefail
mode=${1:?check mode required}
[ "$(id -u)" != 0 ] || { echo 'PostgreSQL tests must run as an unprivileged user' >&2; exit 2; }
source_root=$(cd "$(dirname "$0")/.." && pwd)
build_root="$source_root/build-ci/$mode"
build_jobs=${BUILD_JOBS:-4}
test_jobs=${TEST_JOBS:-8}
export PGCTLTIMEOUT=120
export PROVE_FLAGS=--timer
export TEMP_CONFIG="$source_root/src/tools/ci/pg_ci_base.conf"
export PG_TEST_EXTRA='kerberos ldap ssl libpq_encryption load_balance oauth'
export UBSAN_OPTIONS=print_stacktrace=1:disable_coredump=0:abort_on_error=1:verbosity=2
export ASAN_OPTIONS=print_stacktrace=1:disable_coredump=0:abort_on_error=1:detect_leaks=0
ulimit -c unlimited
mkdir -p "$build_root"
features=(--with-gssapi --with-icu --with-ldap --with-libcurl --with-libxml
  --with-libxslt --with-llvm --with-lz4 --with-pam --with-perl --with-python
  --with-selinux --with-ssl=openssl --with-systemd --with-tcl
  --with-uuid=ossp --with-zstd)
meson_features=(-Dgssapi=enabled -Dicu=enabled -Dldap=enabled -Dlibcurl=enabled
  -Dlibxml=enabled -Dlibxslt=enabled -Dlz4=enabled -Dpam=enabled
  -Dplperl=enabled -Dplpython=enabled -Dpltcl=enabled -Dselinux=enabled
  -Dssl=openssl -Dsystemd=enabled -Duuid=e2fs -Dzstd=enabled
  -Dliburing=enabled -Dtap_tests=enabled)
case $mode in
  sanity)
    meson setup --buildtype=debug --auto-features=disabled -Dtap_tests=enabled "$build_root" "$source_root"
    ninja -C "$build_root" -j"$build_jobs" all testprep
    meson test --print-errorlogs --no-rebuild -C "$build_root" --suite setup
    meson test --print-errorlogs --no-rebuild -C "$build_root" --num-processes "$test_jobs" cube/regress pg_ctl/001_start_stop
    ;;
  autoconf)
    cd "$build_root"
    export CFLAGS='-Og -ggdb -fno-sanitize-recover=all -fsanitize=address'
    export CXXFLAGS="$CFLAGS" LDFLAGS=-fsanitize=address
    export PG_TEST_PG_COMBINEBACKUP_MODE=--copy-file-range
    "$source_root/configure" --enable-cassert --enable-injection-points --enable-debug \
      --enable-tap-tests --enable-nls --with-segsize-blocks=6 --with-libnuma --with-liburing \
      "${features[@]}" CLANG=clang
    make -s -j"$build_jobs" world-bin
    make -s -j"$test_jobs" -Otarget check-world PROVE_FLAGS=--timer
    ;;
  meson|meson32)
    export CFLAGS='-Og -ggdb -fno-sanitize-recover=all -fsanitize=alignment,undefined'
    export CXXFLAGS="$CFLAGS" LDFLAGS=-fsanitize=alignment,undefined
    export PG_TEST_INITDB_EXTRA_OPTS='-c io_method=io_uring'
    if [ "$mode" = meson32 ]; then
      llvm=(-Dllvm=disabled -Dlibnuma=disabled)
      export PYTHONCOERCECLOCALE=0 LANG=C
    else
      llvm=(-Dllvm=enabled -Dlibnuma=enabled)
    fi
    meson setup --buildtype=debug -Dcassert=true -Dinjection_points=true \
      "${meson_features[@]}" "${llvm[@]}" "$build_root" "$source_root"
    ninja -C "$build_root" -j"$build_jobs" all testprep
    ninja -C "$build_root" -t missingdeps
    meson test --print-errorlogs --no-rebuild -C "$build_root" --num-processes "$test_jobs"
    ;;
  warnings)
    cd "$build_root"
    for combination in gcc-dtrace gcc-assert clang clang-assert-dtrace; do
      case $combination in
        gcc-dtrace) compiler=gcc; extra=(--enable-dtrace) ;;
        gcc-assert) compiler=gcc; extra=(--enable-cassert) ;;
        clang) compiler=clang; extra=() ;;
        clang-assert-dtrace) compiler=clang; extra=(--enable-cassert --enable-dtrace) ;;
      esac
      cxx=g++
      if [ "$compiler" = clang ]; then cxx=clang++; fi
      echo "Warnings check: $combination"
      "$source_root/configure" "${features[@]}" "${extra[@]}" CC="$compiler" CXX="$cxx" CLANG=clang
      make -s -j"$build_jobs" world-bin COPT=-Werror
      make -s -j"$build_jobs" distclean
    done
    "$source_root/configure" --host=x86_64-w64-mingw32 --enable-cassert \
      --without-icu --without-readline --without-zlib \
      CC=x86_64-w64-mingw32-gcc CXX=x86_64-w64-mingw32-g++
    make -s -j"$build_jobs" world-bin COPT=-Werror
    make -s -j"$build_jobs" distclean
    "$source_root/configure" "${features[@]}" CC=gcc CXX=g++ CLANG=clang
    make -s -j"$build_jobs" -C doc
    make -s headerscheck EXTRAFLAGS=-fmax-errors=10
    make -s cpluspluscheck EXTRAFLAGS=-fmax-errors=10
    ;;
  *) echo "unknown check mode: $mode" >&2; exit 2 ;;
esac
