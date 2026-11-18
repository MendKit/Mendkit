#!/usr/bin/env bash
# Builds signed apt and dnf/zypper repositories from a release's .deb and .rpm, so Linux users get MendKit
# updates through their normal software updater.
#   build-linux-repos.sh <folder with the .deb and .rpm> <output folder>
# Needs LINUX_REPO_GPG_KEY (an ASCII-armoured private key with no passphrase, or with LINUX_REPO_GPG_PASSPHRASE).
# Output: <out>/mendkit.gpg and mendkit.asc (the public key), <out>/apt/... and <out>/rpm/...
set -euo pipefail

src="$(cd "${1:?folder with the packages}" && pwd)"
out="${2:?output folder}"
: "${LINUX_REPO_GPG_KEY:?}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

export GNUPGHOME="$(mktemp -d)"
chmod 700 "$GNUPGHOME"
printf '%s\n' "$LINUX_REPO_GPG_KEY" | gpg --batch --import 2>/dev/null
key=$(gpg --batch --list-secret-keys --with-colons | awk -F: '/^fpr:/ {print $10; exit}')
[ -n "$key" ] || { echo "::error::LINUX_REPO_GPG_KEY did not contain a private key"; exit 1; }
pass=(--pinentry-mode loopback --passphrase "${LINUX_REPO_GPG_PASSPHRASE:-}")
sign() { gpg --batch --yes "${pass[@]}" --local-user "$key" "$@"; }

gpg --batch --export "$key" > "$out/mendkit.gpg"
gpg --batch --armor --export "$key" > "$out/mendkit.asc"

# ---- apt (Debian, Ubuntu, Mint) ----
deb=$(ls "$src"/*.deb | head -1)
mkdir -p "$out/apt/pool/main" "$out/apt/dists/stable/main/binary-amd64"
cp "$deb" "$out/apt/pool/main/"
(
  cd "$out/apt"
  apt-ftparchive packages pool/main > dists/stable/main/binary-amd64/Packages
  gzip -9kf dists/stable/main/binary-amd64/Packages
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=MendKit -o APT::FTPArchive::Release::Label=MendKit \
    -o APT::FTPArchive::Release::Suite=stable -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 -o APT::FTPArchive::Release::Components=main \
    -o "APT::FTPArchive::Release::Description=MendKit repair, tune-up and migration toolkit" \
    release dists/stable > dists/stable/Release
  sign --clearsign -o dists/stable/InRelease dists/stable/Release
  sign --armor --detach-sign -o dists/stable/Release.gpg dists/stable/Release
)

# ---- rpm (Fedora, openSUSE, RHEL-family) ----
rpmfile=$(ls "$src"/*.rpm | head -1)
mkdir -p "$out/rpm"
cp "$rpmfile" "$out/rpm/"
cat > "$GNUPGHOME/rpmmacros" <<EOF
%_gpg_name $key
%_gpg_path $GNUPGHOME
%__gpg_sign_cmd %{__gpg} --batch --no-verbose --no-armor --pinentry-mode loopback --passphrase "${LINUX_REPO_GPG_PASSPHRASE:-}" --no-secmem-warning -u "%{_gpg_name}" -sbo %{__signature_filename} %{__plaintext_filename}
EOF
rpmsign --macros="/usr/lib/rpm/macros:$GNUPGHOME/rpmmacros" --addsign "$out/rpm/$(basename "$rpmfile")" >/dev/null
createrepo_c --quiet "$out/rpm"
sign --armor --detach-sign -o "$out/rpm/repodata/repomd.xml.asc" "$out/rpm/repodata/repomd.xml"
cp "$out/mendkit.asc" "$out/rpm/repodata/repomd.xml.key"
cat > "$out/rpm/mendkit.repo" <<EOF
[mendkit]
name=MendKit
baseurl=${REPO_URL:-https://example.invalid}/rpm
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=${REPO_URL:-https://example.invalid}/mendkit.asc
EOF

rm -rf "$GNUPGHOME"
echo "Repositories built in $out"
