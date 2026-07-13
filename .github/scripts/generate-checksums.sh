#!/bin/sh

set -eu

if [ "$#" -ne 2 ]; then
	echo "usage: $0 <artifact-directory> <output>" >&2
	exit 2
fi

artifact_dir=$1
output=$2

find "$artifact_dir" -type f \( -name '*.zip' -o -name '*.tar.gz' \) -print |
	LC_ALL=C sort |
	while IFS= read -r file; do
		digest=$(sha256sum "$file" | awk '{ print $1 }')
		printf '%s  %s\n' "$digest" "${file##*/}"
	done > "$output"

if [ ! -s "$output" ]; then
	echo "No release archives found under $artifact_dir" >&2
	exit 1
fi
