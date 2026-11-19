#!/bin/sh
# Run on Linux, or in the dev image: sh scripts/test-docker-entrypoint.sh
set -eu
entrypoint="$(pwd)/scripts/docker-dev-entrypoint.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
cd "$test_dir"
mkdir bin node_modules
export install_log="$test_dir/installs"
cat > bin/npm <<'SH'
#!/bin/sh
echo install >> "$install_log"
if [ "${FAIL_INSTALL:-false}" = true ]; then exit 1; fi
SH
chmod +x bin/npm
export PATH="$test_dir/bin:$PATH"
echo '{}' > package.json
echo '{}' > package-lock.json

# A fresh/missing dependency volume installs before running the command.
sh "$entrypoint" sh -c 'echo started > started'
test -f started
test "$(wc -l < installs)" -eq 1

# A matching volume skips installation.
sh "$entrypoint" true
test "$(wc -l < installs)" -eq 1

# Both lockfile and manifest changes invalidate the volume independently.
echo '{"changed":true}' > package-lock.json
sh "$entrypoint" true
test "$(wc -l < installs)" -eq 2
echo '{"name":"changed"}' > package.json
sh "$entrypoint" true
test "$(wc -l < installs)" -eq 3

# A failed install must stop startup, and the next invocation must retry.
echo '{"changed":false}' > package-lock.json
if FAIL_INSTALL=true sh "$entrypoint" sh -c 'touch incorrectly-started'; then
  echo 'Expected installation failure' >&2
  exit 1
fi
test ! -f incorrectly-started
sh "$entrypoint" true
test "$(wc -l < installs)" -eq 5
echo 'Docker entrypoint checks passed.'
