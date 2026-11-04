#!/usr/bin/env bash
set -euo pipefail

accepted_archive="$(realpath -- "$1")"
shift

publication_directory="$(mktemp -d)"
trap 'rm -rf -- "$publication_directory"' EXIT

tar -xzf "$accepted_archive" -C "$publication_directory"
cd "$publication_directory/package"

node --input-type=module -e '
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
if (["_from", "_resolved", "_where"].some(field => Object.hasOwn(manifest, field))) {
  throw new Error("Publication manifest contains local installation metadata");
}
'

npm pack --ignore-scripts --pack-destination "$publication_directory" >/dev/null
packed_archives=("$publication_directory"/*.tgz)
test "${#packed_archives[@]}" -eq 1
cmp "$accepted_archive" "${packed_archives[0]}"

npm publish . "$@" --ignore-scripts --access public
