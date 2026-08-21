#!/usr/bin/env bash
# Compile the admissibility policy to the Wasm artifact the app loads at
# activation time (SPEC §19.5).
#
#   pnpm --filter vendra policy:build
#
# The artifact is committed, so this only needs re-running when
# company-policy.rego changes. `policy/repo.rego` asserts it is not stale.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPA="${OPA:-$HOME/.local/bin/opa}"
command -v "$OPA" >/dev/null 2>&1 || { echo "opa not found at $OPA"; exit 127; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Gate on the tests before producing an artifact anyone will trust.
"$OPA" check --strict --capabilities "$DIR/capabilities-pinned.json" "$DIR/company-policy.rego"
"$OPA" test --capabilities "$DIR/capabilities-pinned.json" \
  "$DIR/company-policy.rego" "$DIR/company-policy_test.rego"

"$OPA" build -t wasm -e 'vendra/policy/admission/decision' \
  --capabilities "$DIR/capabilities-pinned.json" \
  "$DIR/company-policy.rego" -o "$TMP/bundle.tar.gz"
tar xzf "$TMP/bundle.tar.gz" -C "$TMP"
find "$TMP" -name '*.wasm' -exec cp {} "$DIR/company-policy.wasm" \;
chmod 644 "$DIR/company-policy.wasm"

# A manifest so the suite can check integrity by CONTENT, not by mtime (which is
# meaningless after a clone): the source hash the artifact was built from, the
# entrypoint the app must call, and the host built-ins the module requires.
node -e '
const fs = require("fs"), crypto = require("crypto");
const dir = process.argv[1];
const wasm = fs.readFileSync(dir + "/company-policy.wasm");
const rego = fs.readFileSync(dir + "/company-policy.rego");
WebAssembly.compile(wasm).then(async (mod) => {
  const memory = new WebAssembly.Memory({ initial: 8 });
  const nop = () => 0;
  const i = await WebAssembly.instantiate(mod, { env: { memory,
    opa_abort: nop, opa_println: nop, opa_builtin0: nop, opa_builtin1: nop,
    opa_builtin2: nop, opa_builtin3: nop, opa_builtin4: nop } });
  const dump = (addr) => {
    const s = i.exports.opa_json_dump(addr);
    const mem = new Uint8Array((i.exports.memory ?? memory).buffer);
    let e = s; while (mem[e] !== 0) e++;
    return JSON.parse(new TextDecoder().decode(mem.subarray(s, e)));
  };
  fs.writeFileSync(dir + "/company-policy.wasm.json", JSON.stringify({
    rego_sha256: crypto.createHash("sha256").update(rego).digest("hex"),
    wasm_sha256: crypto.createHash("sha256").update(wasm).digest("hex"),
    entrypoints: Object.keys(dump(i.exports.entrypoints())),
    host_builtins: Object.keys(dump(i.exports.builtins())),
    abi: `${i.exports.opa_wasm_abi_version.value}.${i.exports.opa_wasm_abi_minor_version.value}`,
  }, null, 2) + "\n");
});
' "$DIR"

echo "built $DIR/company-policy.wasm ($(stat -c%s "$DIR/company-policy.wasm") bytes)"
echo "manifest: $(tr -d '\n ' < "$DIR/company-policy.wasm.json" | head -c 200)"
