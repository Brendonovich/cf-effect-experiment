# HTTP Client plugin

The engine validates and performs outbound HTTP requests. It follows at most five
redirects and validates every redirect target before sending the next request.
HTTP status codes, including non-2xx statuses, are emitted as action data.

`UrlPolicy.secureLayer` is the production default. It requires HTTPS and blocks
URL credentials, local/internal names, non-public IPv4 ranges, and IPv6 literals.
DNS-based private-address and tenant allow-list enforcement is environment-specific;
hosted deployments can inject a stricter `UrlPolicy` before any request is sent.

The standalone server intentionally uses `Deployment/Local`, whose policy permits
HTTP and private development services. Both policies still reject malformed URLs,
non-HTTP protocols, and URL credentials.
