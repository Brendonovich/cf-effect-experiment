# HTTP Client Plugin

Seven schemas: five HTTP actions and two pure URL component helpers. This ports
the useful request/response behavior of Electron's HTTP package without depending
on Electron, browser globals, or filesystem access.

## Nodes

| Schema ID            | Name                 | Method / Operation                     |
| -------------------- | -------------------- | -------------------------------------- |
| `HttpGet`            | HTTP GET             | GET, no request body                   |
| `HttpPost`           | HTTP POST            | POST                                   |
| `HttpPut`            | HTTP PUT             | PUT (not the legacy Electron POST bug) |
| `HttpPatch`          | HTTP PATCH           | PATCH                                  |
| `HttpDelete`         | HTTP DELETE          | DELETE                                 |
| `URLEncodeComponent` | URL Encode Component | `encodeURIComponent`                   |
| `URLDecodeComponent` | URL Decode Component | `decodeURIComponent`                   |

Existing action IDs and `exec`, `url`, and `status` pins are unchanged. `url`
still defaults to `https://`; `status` is still an Int, including for non-2xx
responses. Saved graphs that only use URL and status need no new defaults.

All actions accept `headers`, a JSON object of string values, defaulting to `{}`.
POST, PUT, PATCH, and DELETE also accept `body`, text defaulting to `""`. An empty
body means no body is sent, preserving the original behavior. Nonempty text
defaults to `text/plain; charset=utf-8` unless a `Content-Type` header is supplied.
JSON and HTML are sent as text with their explicit content type, for example:

```json
{ "Content-Type": "application/json", "Authorization": "Bearer YOUR_TOKEN" }
```

New outputs are `responseBody` (UTF-8 text), `contentType` (the full header value,
including parameters, or `""`), and `responseHeaders` (a JSON object with normalized
lowercase names). Missing/empty bodies produce `""`. Unknown content types and
non-2xx responses still return text; JSON is not parsed automatically. Invalid
UTF-8 bytes are replaced, so this is not a binary download API. Duplicate response
headers follow the underlying HTTP client's normalized/combined representation.

URL helpers have String `input`/`output` pins, default input `""`, and no execution
pins or engine requirements. They encode components rather than whole URLs.
Decoding does not convert `+` to space. Malformed percent escapes/UTF-8 and lone
surrogates during encoding fail with `HttpUrlComponentFailure`.

## Limits And Errors

- Request and response bodies are limited to 1 MiB of bytes, not characters.
- Request JSON headers and terminal response serialized headers are limited to 64 KiB.
- Response limits are enforced while streaming, even with missing or misleading `Content-Length`.
- The 30-second timeout covers all redirects and terminal body consumption; scopes release responses on success, failure, and timeout.
- At most five redirects are followed; each target is validated and redirect loops fail.
- POST on 301/302 and all methods on 303 become GET without a body or body headers. 307/308 preserve methods and bodies; PUT on 301/302 stays PUT.
- Cross-origin redirects strip caller headers, including authorization, cookies, and custom API keys. A replayed body's explicit content type is retained.
- Ambient Fetch credentials are omitted and automatic Fetch redirects are disabled.
- Malformed JSON, non-string header values, invalid header names/values, case-insensitive duplicate names, and transport-controlled headers fail before network access.
- `Host`, `Content-Length`, hop-by-hop headers, and `Proxy-*`/`Sec-*` headers cannot be supplied. A nonempty GET body is rejected by the RPC.

URL, validation, transport, body-read, size, redirect, and timeout errors are typed
`HttpClientRequestFailure` values with method, URL, and reason. URL credentials
are rejected and redacted in errors. Header-validation errors do not echo values.

## Deployments And Compatibility

`UrlPolicy.secureLayer` is the hosted production default. It requires HTTPS on
port 443 and blocks URL credentials, local/internal names, non-public IPv4, and
non-public/special-use IPv6. Public IPv6 remains allowed. DNS rebinding and
DNS-resolved private addresses require deployment-level egress restrictions;
hosted deployments can inject a stricter policy or tenant allow-list.

The standalone server intentionally uses `Deployment/Local`, whose policy permits
HTTP and private development services. Both policies still reject malformed URLs,
non-HTTP protocols, and URL credentials. No network policy was relaxed for this port.

The original `HttpClientRequest({ method, url })` RPC still returns only the status
and discards response bodies, preserving existing external and Cloudflare Workflow
runtime callers. Actions use the additive `HttpClientRequestText` RPC, returning
`{ status, body, contentType, headers }`. `makeRuntimeClient` exposes both RPCs and
continues to use the deployment's Effect HTTP client and URL policy. No additional
dependencies or app changes are required for clients created through this factory.

Electron's Body enum and map pins are represented by text and JSON-string headers
in the current type system, not by persisted Electron graph migration. Form data
can be supplied as explicitly encoded text with its content type; automatic
multipart encoding and binary bodies are not provided.

`GET File` is deferred until a scoped artifact/download capability exists. This
plugin never writes arbitrary paths or implicitly opts into the filesystem plugin.

## Verification

```sh
pnpm --filter @macrograph/plugin-http-client run test --run
pnpm typecheck
```
