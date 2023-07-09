"use strict";

let Caddy = module.exports;

// srv443
let caddySrv = "srv443";

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
  let myLxcId = site.hostname.replace(/\./g, "_");

  let tlsSshRouting = {
    "@id": `${myLxcId}_tls_routing`,
    handler: "subroute",
    routes: [
      {
        handle: [
          {
            connection_policies: [{ alpn: ["http/1.1"] }],
            handler: "tls",
          },
          {
            handler: "subroute",
            routes: [
              {
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
                match: [{ ssh: {} }],
              },
              {
                match: [{ http: [{ host: [site.hostname] }] }],
              },
            ],
          },
        ],
        match: [{ tls: { sni: [site.hostname] } }],
      },
    ],
  };

  // enable ssh tls routing
  config.apps.http.servers[caddySrv].listener_wrappers[0].routes[0].handle.push(
    tlsSshRouting
  );
};

Caddy.addHttpProxy = function (config, site) {
  let myLxcId = site.hostname.replace(/\./g, "_");

  let proxyHost = site.hostname;
  let proxyTransport;
  if (site.https) {
    proxyHost = site.internal_ip;
    proxyTransport = {
      protocol: "http",
      tls: { insecure_skip_verify: true },
    };
  }

  let tlsHttpProxy = {
    "@id": `${myLxcId}_http_routing`,
    handle: [
      {
        handler: "subroute",
        routes: [
          {
            handle: [
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
          },
        ],
      },
    ],
    match: [{ host: [site.hostname] }],
    terminal: true,
  };

  // enable http proxy
  config.apps.http.servers[caddySrv].routes.push(tlsHttpProxy);
};
