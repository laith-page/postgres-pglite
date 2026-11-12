#!/usr/bin/env bash
set -euo pipefail
mode=${1:?dependency mode required}
export DEBIAN_FRONTEND=noninteractive
apt-get update
base=(build-essential bison flex pkgconf meson ninja-build python3-dev
  gettext libreadline-dev zlib1g-dev libssl-dev libxml2-dev libxslt1-dev
  libicu-dev libldap2-dev libkrb5-dev libcurl4-openssl-dev liblz4-dev
  libpam0g-dev libperl-dev libselinux1-dev libsystemd-dev tcl-dev
  uuid-dev libossp-uuid-dev libzstd-dev liburing-dev libipc-run-perl
  libio-pty-perl krb5-kdc krb5-admin-server ldap-utils slapd openssl
  locales ca-certificates git)
case $mode in
  sanity) packages=(build-essential bison flex pkgconf meson ninja-build libipc-run-perl) ;;
  meson32) packages=("${base[@]}") ;;
  native) packages=("${base[@]}" libnuma-dev llvm-dev clang libclang-dev) ;;
  warnings) packages=("${base[@]}" libnuma-dev llvm-dev clang libclang-dev
    systemtap-sdt-dev mingw-w64 docbook-xml
    docbook-xsl libxml2-utils xsltproc) ;;
  *) echo "unknown dependency mode: $mode" >&2; exit 2 ;;
esac
apt-get install -y --no-install-recommends "${packages[@]}"
if [ "$mode" = native ] && [ -f /etc/apparmor.d/usr.sbin.slapd ]; then
  # Ubuntu confines slapd to its system directories. The LDAP TAP suites use
  # private configuration, certificates, databases and logs in this checkout.
  # Retain the profile and permit only these owner-controlled test directories.
  test_workspace=$(pwd -P)
  case $test_workspace in
    *[!a-zA-Z0-9_./-]*) echo 'unsupported AppArmor workspace path' >&2; exit 2 ;;
  esac
  grep -Fq '<local/usr.sbin.slapd>' /etc/apparmor.d/usr.sbin.slapd
  mkdir -p /etc/apparmor.d/local
  for test_tree in \
    meson/testrun/ldap \
    meson/testrun/ldap_password_func \
    autoconf/src/test/ldap/tmp_check \
    autoconf/src/test/modules/ldap_password_func/tmp_check; do
    rule="owner \"$test_workspace/build-ci/$test_tree/**\" rwk,"
    if ! grep -Fxq "$rule" /etc/apparmor.d/local/usr.sbin.slapd 2>/dev/null; then
      printf '%s\n' "$rule" >> /etc/apparmor.d/local/usr.sbin.slapd
    fi
  done
  apparmor_parser -r /etc/apparmor.d/usr.sbin.slapd
fi
if [ "$mode" != sanity ]; then
  sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen
  locale-gen en_US.UTF-8
  if ! grep -q 'pg-loadbalancetest' /etc/hosts; then
    printf '127.0.0.1 pg-loadbalancetest\n127.0.0.2 pg-loadbalancetest\n127.0.0.3 pg-loadbalancetest\n' >> /etc/hosts
  fi
fi
