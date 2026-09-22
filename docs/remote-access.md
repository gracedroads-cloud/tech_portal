# Secure mobile access

Set a long, random `DISPATCH_API_KEY` in the server environment before exposing this
application beyond a trusted local network. Requests to `/api/*` then require that key
as an `X-API-Key` header or Bearer token. The dashboard accepts a temporary
`?apiKey=` bootstrap value and stores it in the browser session so its API and SSE
requests can authenticate. Do not share or bookmark URLs containing a key; remove the
query parameter after the page has loaded.

## Cloudflare Tunnel

1. Install `cloudflared` on the machine running the console.
2. Authenticate with `cloudflared tunnel login`, create a named tunnel, and map a
   hostname to `http://localhost:3000`.
3. Store the tunnel token and `DISPATCH_API_KEY` in the operating system's protected
   service environment, not in `.env` or source control.
4. Configure Cloudflare Access with your organization identity provider and require
   MFA before allowing the hostname.

## Tailscale

1. Install Tailscale on the server and authorized mobile devices, then sign in to the
   same tailnet.
2. Use a restrictive ACL that permits only authorized operators to reach the server's
   port 3000.
3. Prefer MagicDNS or a stable tailnet IP, and keep `DISPATCH_API_KEY` enabled as a
   second application-layer control.

Never expose port 3000 directly to the public internet. Use one of these encrypted,
identity-aware paths instead.
