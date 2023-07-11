"use strict";

let Caddy = module.exports;

const SRV_443 = "srv443";

Caddy.addTls = function (config, site) {
  let myLxcId = site.hostname.replace(/\./g, "_");

  let tlsPolicy = {
    "@id": `${myLxcId}_tls_policy`,
    subjects: [site.hostname],
  };

  // // See https://github.com/caddy-dns/lego-deprecated/
  // // (there's nothing at https://caddyserver.com/docs/modules/dns.providers.lego_deprecated)
  //
  // let tlsPolicy = {
  //   "@id": `${myLxcId}_tls_policy`,
  //   subjects: [site.hostname],
  //   issuers: [
  //     {
  //       challenges: {
  //         dns: {
  //           provider: { api_token: "{env.DUCKDNS_API_TOKEN}", name: "duckdns" },
  //         },
  //       },
  //       module: "acme",
  //     },
  //     {
  //       challenges: {
  //         dns: {
  //           provider: { api_token: "{env.DUCKDNS_API_TOKEN}", name: "duckdns" },
  //         },
  //       },
  //       module: "zerossl",
  //     },
  //   ],
  // };

  // per-domain tls policies
  config.apps.tls.automation.policies.push(tlsPolicy);

  // enables automatic renewal per tls policy
  config.apps.tls.certificates.automate.push(site.hostname);
};

Caddy.addSshProxy = function (config, site) {
  if (!site.internal_ip) {
    return;
  }

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
          {
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
          },
        ],
      },
    ],
  };

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
    let proxyHost = site.hostname;
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

  if (site.static_root) {
    let staticPath = site.static_path;
    if (!staticPath) {
      staticPath = "/*";
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
          root: `/home/app/srv/${site.hostname}/`,
        },
        {
          handler: "file_server",
          hide: [".env"],
        },
      ],
    };

    matchHostnameAndHandle.handle[0].routes.push(matchStaticRoot);
  }

  // enable http proxy
  config.apps.http.servers[SRV_443].routes.push(matchHostnameAndHandle);
};
