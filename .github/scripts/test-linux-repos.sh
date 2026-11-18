#!/usr/bin/env bash
# Builds small test packages, signs them into repositories with a throwaway key using build-linux-repos.sh,
# and leaves them in ./repo-test/out for the install checks in other containers.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
T="$PWD/repo-test"; rm -rf "$T"; mkdir -p "$T/pkgs" "$T/deb/DEBIAN" "$T/deb/usr/share/mendkit" "$T/rb/SPECS"
printf 'Package: mendkit\nVersion: 0.0.1\nArchitecture: amd64\nMaintainer: MendKit <x@y>\nDescription: repository test\n' > "$T/deb/DEBIAN/control"
echo test > "$T/deb/usr/share/mendkit/test"
dpkg-deb -b "$T/deb" "$T/pkgs/MendKit-0.0.1-amd64.deb" >/dev/null
cat > "$T/rb/SPECS/m.spec" <<'EOF'
Name: mendkit
Version: 0.0.1
Release: 1
Summary: repository test
License: MIT
BuildArch: x86_64
%description
repository test
%install
mkdir -p %{buildroot}/usr/share/mendkit && echo test > %{buildroot}/usr/share/mendkit/test
%files
/usr/share/mendkit/test
EOF
rpmbuild -bb --define "_topdir $T/rb" "$T/rb/SPECS/m.spec" >/dev/null 2>&1
cp "$T"/rb/RPMS/x86_64/*.rpm "$T/pkgs/MendKit-0.0.1-x86_64.rpm"
export GNUPGHOME="$T/key"; mkdir -m 700 "$GNUPGHOME"
gpg --batch --passphrase '' --quick-gen-key "MendKit Repo Test <test@invalid>" rsa3072 sign never 2>/dev/null
LINUX_REPO_GPG_KEY="$(gpg --armor --export-secret-keys)"; export LINUX_REPO_GPG_KEY; unset GNUPGHOME
REPO_URL="file:///repo" bash "$here/build-linux-repos.sh" "$T/pkgs" "$T/out"
