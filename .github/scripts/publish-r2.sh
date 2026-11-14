#!/usr/bin/env bash
# Uploads a built MendKit release to the Cloudflare R2 bucket.
#   publish-r2.sh <folder with the build output>
# Needs VERSION, R2_ACCOUNT_ID, R2_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
# OVERWRITE=true allows replacing a version the bucket already has.
set -euo pipefail

dir="${1:?folder with the build output}"
: "${VERSION:?}" "${R2_ACCOUNT_ID:?}" "${R2_BUCKET:?}"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
s3() { aws s3 "$@" --endpoint-url "$endpoint" --only-show-errors; }

cd "$dir"
v="$VERSION"
# Versioned file name -> fixed "latest" name the website links to.
declare -A latest=(
  ["MendKit-Setup-$v.exe"]="MendKit-Setup-latest.exe"
  ["MendKit-Portable-$v.exe"]="MendKit-Portable-latest.exe"
  ["MendKit-$v-arm64.dmg"]="MendKit-latest-arm64.dmg"
  ["MendKit-$v-x86_64.AppImage"]="MendKit-latest-x86_64.AppImage"
  ["MendKit-$v-x64.tar.gz"]="MendKit-latest-x64.tar.gz"
)
feeds=(latest.yml latest-mac.yml latest-linux.yml)

echo "Files from the build:"
ls -la
missing=0
for f in "${!latest[@]}" "${feeds[@]}"; do
  [ -f "$f" ] || { echo "::error::The build did not produce $f"; missing=1; }
done
for f in "${feeds[@]}"; do
  if [ -f "$f" ] && ! grep -q "^version: $v\$" "$f"; then echo "::error::$f is not for version $v"; missing=1; fi
done
[ "$missing" = 0 ]

published=$(aws s3 cp "s3://$R2_BUCKET/latest.yml" - --endpoint-url "$endpoint" 2>/dev/null | sed -n 's/^version: //p' || true)
echo "The bucket currently offers version: ${published:-none}"
if [ "$published" = "$v" ] && [ "${OVERWRITE:-false}" != "true" ]; then
  echo "::error::Version $v is already published. Use a new version number, or tick 'overwrite' to replace it."
  exit 1
fi

type_of() {
  case "$1" in
    *.exe) echo application/vnd.microsoft.portable-executable ;;
    *.dmg) echo application/x-apple-diskimage ;;
    *.AppImage) echo application/vnd.appimage ;;
    *.tar.gz) echo application/gzip ;;
    *.yml) echo text/yaml ;;
    *.json) echo application/json ;;
    *) echo application/octet-stream ;;
  esac
}

# 1. Installers under their versioned names, plus the blockmaps used for smaller updates.
for f in "${!latest[@]}" *.blockmap; do
  [ -f "$f" ] || continue
  echo "Uploading $f"
  s3 cp "$f" "s3://$R2_BUCKET/$f" --content-type "$(type_of "$f")" --cache-control "public, max-age=86400"
done

# 2. The same installers under fixed names, so the website's links always give the newest version.
for f in "${!latest[@]}"; do
  echo "Uploading ${latest[$f]}"
  s3 cp "$f" "s3://$R2_BUCKET/${latest[$f]}" --content-type "$(type_of "$f")" --cache-control "public, max-age=300" \
    --content-disposition "attachment; filename=\"$f\""
done

# 3. version.json for the website: the version, date and the real file names and sizes.
size() { stat -c %s "$1"; }
cat > version.json <<JSON
{
  "version": "$v",
  "released": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": {
    "windows": { "name": "MendKit-Setup-$v.exe", "size": $(size "MendKit-Setup-$v.exe") },
    "portable": { "name": "MendKit-Portable-$v.exe", "size": $(size "MendKit-Portable-$v.exe") },
    "mac": { "name": "MendKit-$v-arm64.dmg", "size": $(size "MendKit-$v-arm64.dmg") },
    "appimage": { "name": "MendKit-$v-x86_64.AppImage", "size": $(size "MendKit-$v-x86_64.AppImage") },
    "targz": { "name": "MendKit-$v-x64.tar.gz", "size": $(size "MendKit-$v-x64.tar.gz") }
  }
}
JSON
cat version.json

# 4. Last: the update feeds and version.json. Installed copies only see the new version from here on.
for f in "${feeds[@]}" version.json; do
  echo "Uploading $f"
  s3 cp "$f" "s3://$R2_BUCKET/$f" --content-type "$(type_of "$f")" --cache-control "no-cache, max-age=0"
done

echo "Published MendKit $v."
