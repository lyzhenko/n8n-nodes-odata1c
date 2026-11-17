# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please report security issues privately: open a
[private security advisory](https://github.com/lyzhenko/n8n-nodes-odata1c/security/advisories/new)
or write to <alexander.lyzhenko@yandex.ru>. Do not open a public issue for a
vulnerability. An acknowledgement is sent within 3 business days.

## Security notes for users

* **Credentials.** The 1C user name and password are stored by n8n in its database,
  encrypted with `N8N_ENCRYPTION_KEY`. Back up that key: without it the saved
  credentials cannot be decrypted. The node never logs the password and never puts
  credentials into a URL.
* **Dedicated user.** Create a separate 1C user for n8n with the minimum rights.
  OData grants full CRUD within that user's rights, including physical `DELETE`.
* **HTTPS.** Publish the infobase over HTTPS. The credential has an
  **Ignore SSL Issues** switch for self-signed certificates; enabling it makes the
  connection vulnerable to man-in-the-middle attacks inside the network. Prefer a
  valid certificate or an internal CA.
* **Network exposure.** 1C OData should not be reachable from the internet without a
  reverse proxy, TLS and rate limiting. Use a VPN or a firewall allow-list.
* **Data load mode.** `1C_OData-DataLoadMode: true` makes 1C treat a write as a data
  exchange, which skips some interactive checks. Enable it only for trusted,
  controlled integrations.
* **n8n community packages.** Install this package from npm or from a tarball you
  built yourself; verify the package name and version before installing unverified
  community nodes.
