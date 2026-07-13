#!/bin/sh

set -eu

if [ "$#" -ne 5 ]; then
	echo "usage: $0 <tag> <changelog> <output> <package.json> <wails.json>" >&2
	exit 2
fi

tag=$1
changelog=$2
output=$3
package_json=$4
wails_json=$5
version=${tag#v}
base_version=${version%%-*}
header_prefix="## [$base_version] - "

header=$(awk -v prefix="$header_prefix" 'index($0, prefix) == 1 { print; exit }' "$changelog")
if [ -z "$header" ]; then
	echo "No curated changelog section found for $base_version" >&2
	exit 1
fi

package_version=$(awk -F'"' '$2 == "version" { print $4; exit }' "$package_json")
if [ "$package_version" != "$base_version" ]; then
	echo "package version $package_version does not match tag $tag" >&2
	exit 1
fi

# wails build stamps info.productVersion into the packaged binaries
# (Info.plist / Windows file version); guard it so a release cannot ship apps
# advertising the Wails default of 1.0.0.
wails_version=$(awk -F'"' '$2 == "productVersion" { print $4; exit }' "$wails_json")
if [ "$wails_version" != "$base_version" ]; then
	echo "wails productVersion $wails_version does not match tag $tag" >&2
	exit 1
fi

release_date=${header#"$header_prefix"}
if [ "$version" = "$base_version" ] && ! printf '%s\n' "$release_date" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
	echo "replace Pending with the release date before tagging $tag" >&2
	exit 1
fi

awk -v target="$header" '
	$0 == target { in_section = 1; next }
	in_section && index($0, "## [") == 1 { exit }
	in_section { print }
' "$changelog" > "$output"

if ! grep -q '[^[:space:]]' "$output"; then
	echo "Curated changelog section for $base_version is empty" >&2
	exit 1
fi
