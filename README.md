# Resumable download integrity kit

A small acceptance kit for the moment you add HTTP Range resume to a downloader.
It catches a common corruption bug: a server returns a complete `200` response,
but the client appends it to an old partial file as though it were `206`.

Run a correct reference adapter and a deliberately wrong append-only adapter
against the same synthetic HTTP fixtures. Check the final SHA-256, every
instrumented publication, and preservation of the previous destination on error.
There are no runtime dependencies or external requests. This is a copyable test
kit, not a production download client or a comprehensive HTTP conformance suite.

## Run it

Use Node.js 22 or newer on Linux (the verified platform). No `npm install` is needed.

```sh
git clone https://github.com/mytestapp20261001-collab/resume-download-integrity-kit.git
cd resume-download-integrity-kit
npm test
node bin/run.mjs > result.json
node bin/run.mjs --adapter adapters/wrong-append.mjs > negative.json
# The final command intentionally exits 1. It demonstrates detection, not a broken kit.
```

The CLI prints one JSON report to stdout. Exit `0` means every selected policy
check passed; `1` means an adapter failed checks; `2` is a setup or usage error.
A successful report has `schemaVersion: 1`, `policy: "strict-single-response-v1"`,
`passed: true`, `total: 15`, and `failures: 0`. Individual results include hashes,
publication records and actionable `issues`. A protocol rejection is an expected
pass in a rejection fixture, not a setup failure.

For example, the bad adapter fails `changed-etag-200` with a final SHA-256
mismatch: the full new response was appended to the old prefix. Its `unproven-416`
case publishes a corrupted partial whose length happens to equal the server's
total. Equal lengths do not establish equal bytes.

## What the 15 fixtures require

This release selects a deliberately conservative, **single-response policy**.
Each adapter makes one GET with `Range`, the seed's strong `If-Range` ETag, and
`Accept-Encoding: identity`. Policy failures are not all HTTP violations.

| Fixture | Required result under this policy |
| --- | --- |
| Matching-validator 206 | Validate range and validator; publish the full reconstructed v1 hash |
| Changed ETag, full 200 | Discard the old prefix; publish the complete v2 response |
| Ignored Range, full 200 | Replace from byte zero; publish the complete v1 response |
| Wrong start, reversed end, or end outside total (3) | Reject; preserve destination and partial |
| Unknown total 206 | Reject under this kit's complete-file policy; unknown totals can be legal HTTP |
| Short body with complete framing | Reject because the body does not match Content-Range |
| Truncated 206 framing | Reject the interrupted body; never publish it |
| Changed, absent, or weak 206 ETag (3) | Reject under the strict matching-validator policy |
| 416 without identity proof | Reject even when local and advertised lengths match |
| Gzip-coded 206 or 200 (2) | Reject; never confuse coded byte ranges with decoded offsets |

The reference only accepts a complete, single range extending to a known final
byte, or a complete 200 with Content-Length. It does not implement multipart
ranges, chunked responses without Content-Length, date validators, retries,
redirects, compression, authentication, TLS, or persisted resume metadata.
A production client may choose safe restart/revalidation strategies instead;
adapt the policy and add explicit fixtures for those choices. Do not change an
expected failure merely to make an unsafe implementation pass.

## Plug in your downloader

Create a trusted local ES module exporting an async function, then run:

```sh
node bin/run.mjs --adapter ./my-adapter.mjs
```

The function receives:

```js
export default async function resume({
  url,              // Generated http://127.0.0.1:<ephemeral-port>/artifact
  partialPath,      // Existing synthetic prefix; keep its bytes unchanged
  metadata,         // { etag: '"fixture-v1"', bytes: <partial length> }
  workDir,          // Owned scratch directory for this one case
  destinationPath,  // Existing unrelated published artifact; do not write directly
  timeoutMs,        // Network deadline, default 1200 ms
  publish,          // await publish(candidatePath), exactly once on success
}) {
  // Connect your request/resume logic here. No real URLs or user files.
  // Stage the complete file directly under workDir, close it, then publish it.
  // Return { status: 'published' } or { status: 'rejected', reason: '...' }.
}
```

See [the reference adapter](adapters/reference.mjs) for a complete implementation.
Keep network/validation logic in your adapter. For an existing downloader,
intercept its final commit operation and call the supplied `publish` function.
Do not write the destination or seed directly. Delete your own staging files
before returning. Do not spawn detached children or modify environment/global
state outside the owned directory.

`publish` records the candidate hash before an atomic same-directory rename.
It checks path/type/size ownership constraints, **not** the expected digest: an
incorrect adapter can publish bad bytes, and the runner will flag the event.
The expected hashes are held by the runner, not supplied as adapter arguments.
This makes the publication boundary observable, including when an adapter claims
rejection after publishing. Direct destination writes violate the contract;
final snapshots alone cannot prove the absence of every transient direct write.

## Safety and evidence boundaries

- The HTTP server binds only `127.0.0.1` on port `0`. Each scenario gets a fresh
  server and scratch directory. No listener is exposed on the LAN
- Bundled requests go only to the generated fixture endpoint. The transport
  rejects other hosts, credentials and query strings; it does not follow redirects
- Fixtures are checked against a committed byte-count/SHA-256 manifest before
  use. v1 and v2 have equal lengths and different contents
- A child process gets an execution deadline (default 3 seconds), no
  inherited environment secrets or Node flags, and bounded captured output.
  On deadline the parent kills its owned POSIX process group and closes captured
  streams, then closes fixture sockets and removes only the
  newly created scratch tree in `finally`
- **Adapters are trusted executable code. This is not a sandbox.** A malicious
  adapter can access the host, evade the contract, spawn descendants, or open
  network connections. Review adapters before running them; the runner does not
  offer OS-level filesystem/network isolation
- The reference buffers tiny fixtures, stages before publication, and never
  mutates the original partial. Atomic rename is tested on Linux; power-loss
  durability, hostile concurrent filesystem mutation and production client
  integration are not established
- A passing run proves these synthetic cases under this contract, not general
  downloader correctness, authentic payload identity, real-world demand, or
  support for all servers/platforms. ETags are validators, not cryptographic
  integrity guarantees

The tests also cover an always-rejecting adapter, recorded bad publication,
missing adapter imports, stalled responses, process deadline cleanup and CLI
exit behavior. CI runs a fresh checkout on Linux with Node 22.0.0 and 24.19.0,
read-only repository permissions, no stored credentials, no cache or secrets,
and no dependency installation. Runtime tests require loopback TCP permission.

## Protocol references and prior art

[RFC 9110 §13.1.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5)
defines If-Range behavior; [§14.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.4)
covers Content-Range; [§15.5.17](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.17)
describes 416. The strict policy choices above intentionally cover less than
those HTTP semantics permit.

[curl's tests](https://github.com/curl/curl/tree/master/tests) already cover a
much broader protocol surface. [WireMock](https://github.com/wiremock/wiremock)
is a general-purpose HTTP mocking system with fault support. This repository's
contribution is a dependency-free, copyable adapter contract with small positive
and negative controls. It does not replace either project.

## License

MIT. See [LICENSE](LICENSE).

---

Optional project note: this repository is maintained as a useful entry point
alongside [MyTest](https://mytest.app), an experimental place for voluntary AI
and human play. This is a transparent promotional link, unrelated to running or
repairing the kit. Visiting is optional and is not claimed to improve task
performance. The code, results and skill do not redirect users or contact MyTest.
