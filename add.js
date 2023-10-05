"use strict";

let Caddy = module.exports;

const SRV_443 = "srv443";
const WILD_PREFIX = "*.";

Caddy.addTls = function (config, site) {
  let myLxcId = site.hostname.replace(/\./g, "_");

  let tlsPolicy = {
    "@id": `${myLxcId}_tls_policy`,
    subjects: [site.hostname],
  };

  let isWild = site.hostname.startsWith(WILD_PREFIX);
  if (isWild) {
    let bare = site.hostname.slice(WILD_PREFIX.length);
    tlsPolicy.subjects.unshift(bare);
  }

  if (site.dns_provider) {
    if (site.dns_provider.token) {
      console.warn();
      console.warn(`[WARN] '${site.hostname}'s`);
      console.warn(
        `[WARN] 'dns_provider.token' should probably be 'dns_provider.api_token'`
      );
      console.warn(
        "       (this is a difference between the Caddyfile and JSON config)"
      );
      console.warn();
    }
    // See https://github.com/caddy-dns/lego-deprecated/
    // (there's nothing at https://caddyserver.com/docs/modules/dns.providers.lego_deprecated)
    tlsPolicy.issuers = [
      {
        challenges: {
          dns: { provider: site.dns_provider },
        },
        module: "acme",
      },
      {
        challenges: {
          dns: { provider: site.dns_provider },
        },
        module: "zerossl",
      },
    ];
  }

  let hasPolicy = false;

  // enables automatic renewal per tls policy
  for (let domain of tlsPolicy.subjects) {
    let hasDomain = config.apps.tls.certificates.automate.includes(domain);
    if (!hasDomain) {
      config.apps.tls.certificates.automate.push(domain);
      continue;
    }

    hasPolicy = true;
    if (tlsPolicy.subjects.length >= 2) {
      throw new Error(
        `duplicate tls policy for '${domain}':\n    wildcards must come before bare domains`
      );
    }
  }

  if (!hasPolicy) {
    // per-domain tls policies
    config.apps.tls.automation.policies.push(tlsPolicy);
  }
};

Caddy.addSshProxy = function (config, site) {
  let myLxcId = site.hostname.replace(/\./g, "_");

  let tlsSshRouting = {
    "@id": `${myLxcId}_tls_routing`,
    handler: "subroute",
    routes: [
      {
        match: [{ tls: { sni: [site.hostname] } }],
        handle: [
          {
            connection_policies: [{ alpn: ["http/1.1"] }],
            handler: "tls",
          },
        ],
      },
    ],
  };

  if (site.internal_ip) {
    let sshProxy = {
      handler: "subroute",
      routes: [
        {
          match: [{ http: [{ host: [site.hostname] }] }],
        },
        {
          match: [{ ssh: {} }],
          handle: [
            {
              handler: "proxy",
              upstreams: [
                {
                  "@id": `${myLxcId}_tls_proxy_ip`,
                  dial: [`${site.internal_ip}:22`],
                },
              ],
            },
          ],
        },
      ],
    };

    tlsSshRouting.routes[0].handle.push(sshProxy);
  }

  // enable ssh tls routing
  config.apps.http.servers[SRV_443].listener_wrappers[0].routes[0].handle.push(
    tlsSshRouting
  );
};

// https://caddyserver.com/docs/json/apps/http/servers/routes/
// Route{
//   Group string?
//   Match Matcher[]?
//   Handle Handler[]
//   Terminal bool?
// }
//
// https://caddyserver.com/docs/json/apps/http/servers/routes/match/
// Match{
//   path string[]?
//   host string[]?
// }
//
// https://caddyserver.com/docs/json/apps/http/
// (halfway down the page)
// Handler{
//   Handler string
//   other stuff
//   subroute
//   - Routes[]?
//   vars
//   - map[string]string
//   file_server
//   - hide string[]
//   rewrite
//   - strip_path_prefix string
//   rewrite
//   - uri tmplstr
//   reverse_proxy
//   - upstream[] Dialer
// }

Caddy.addHttpProxy = function (config, site) {
  let myLxcId = site.hostname.replace(/\./g, "_");

  let matchHostnameAndHandle = {
    "@id": `${myLxcId}_http_routing`,
    match: [{ host: [site.hostname] }],
    terminal: true,
    handle: [
      {
        handler: "subroute",
        routes: [],
      },
    ],
  };

  if (site.internal_port) {
    // let proxyHost = site.hostname;
    let proxyHost = "{http.request.tls.server_name}";
    let proxyTransport;
    if (site.internal_https) {
      let insecureSkipVerify = false !== site.internal_tls_skip_verify;
      proxyHost = site.internal_ip;
      proxyTransport = {
        protocol: "http",
        tls: { insecure_skip_verify: insecureSkipVerify },
      };
    }

    let proxyPath = site.proxy_path;
    if (!proxyPath) {
      proxyPath = "/*";
    }

    let matchDefaultAndProxyRoute = {
      // match is optional, but for consistency we'll match all by default
      "@id": `${myLxcId}_reverse_proxy`,
      match: [{ path: [proxyPath] }],
      terminal: true,
      handle: [
        // rewrites would go here
        {
          handler: "reverse_proxy",

          headers: {
            request: {
              set: { Host: [proxyHost] },
            },
          },

          transport: proxyTransport,

          upstreams: [
            {
              "@id": `${myLxcId}_reverse_proxy_ip`,
              dial: `${site.internal_ip}:${site.internal_port}`,
            },
          ],
        },
      ],
    };

    matchHostnameAndHandle.handle[0].routes.push(matchDefaultAndProxyRoute);
  }

  if (site.static_path) {
    let staticPath = site.static_path;
    if (!staticPath) {
      staticPath = "/*";
    }

    let staticRoot = site.static_root;
    if (!staticRoot) {
      staticRoot = `/srv/www/${site.hostname}/`;
    }

    let matchStaticRoot = {
      // match is optional, but for consistency we'll match all by default
      "@id": `${myLxcId}_static_root`,
      // TODO only one of a group will match
      match: [{ path: [site.static_path] }],
      terminal: true,
      handle: [
        {
          handler: "vars",
          // ex: "/home/app/dist/";
          // (should end in '/')
          root: staticRoot,
        },
        {
          handler: "file_server",
          hide: [".env"],
        },
      ],
    };

    matchHostnameAndHandle.handle[0].routes.push(matchStaticRoot);
  }

  if (site.redirect_location) {
    let redirectPath = site.redirect_path;
    if (!redirectPath) {
      redirectPath = "/*";
    }

    let staticRedirect = {
      match: [{ path: [redirectPath] }],
      terminal: true,
      handle: [
        {
          handler: "static_response",
          headers: {
            // ex: "https://www.{http.request.host}{http.request.uri}"
            Location: [site.redirect_location],
          },
          status_code: 302,
        },
      ],
    };

    matchHostnameAndHandle.handle[0].routes.push(staticRedirect);
  }

  // enable http proxy
  config.apps.http.servers[SRV_443].routes.push(matchHostnameAndHandle);
};
