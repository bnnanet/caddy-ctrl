"use strict";

let Caddy = module.exports;

let myDebugLevel = "INFO";
let myAdminDomain = "sni.m.example.com";
let myAdminIp = "192.168.1.10";

let myAdminSshForward = {
  match: [
    {
      tls: {
        sni: [myAdminDomain],
      },
    },
  ],
  handle: [
    {
      handler: "tls",
      connection_policies: [
        {
          alpn: ["http/1.1"],
        },
      ],
    },
    {
      handler: "subroute",
      routes: [
        {
          match: [
            {
              ssh: {},
            },
          ],
          handle: [
            {
              handler: "proxy",
              upstreams: [
                {
                  dial: ["localhost:22"],
                },
              ],
            },
          ],
        },
        {
          match: [
            {
              http: [
                {
                  host: [myAdminDomain],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

let myAdminApi = {
  match: [
    {
      host: [myAdminDomain],
    },
  ],
  handle: [
    {
      handler: "subroute",
      routes: [
        {
          handle: [
            {
              handler: "authentication",
              providers: {
                http_basic: {
                  accounts: [
                    {
                      password: "{env.CADDY_BCRYPT}",
                      username: "{env.CADDY_USER}",
                    },
                  ],
                  hash: {
                    algorithm: "bcrypt",
                  },
                  hash_cache: {},
                },
              },
            },
            {
              handler: "reverse_proxy",
              headers: {
                request: {
                  set: {
                    Host: ["localhost:2019"],
                  },
                },
              },
              upstreams: [
                {
                  dial: "localhost:2019",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  terminal: true,
};

let redirectToHttps = {
  listen: [":80"],
  routes: [
    {
      handle: [
        {
          handler: "static_response",
          headers: {
            Location: ["https://{http.request.host}{http.request.uri}"],
          },
          status_code: 302,
        },
      ],
      terminal: true,
    },
  ],
};

Caddy.init = {
  admin: {
    config: {
      persist: true,
    },
  },
  logging: {
    logs: {
      default: {
        level: myDebugLevel,
      },
    },
  },
  apps: {
    http: {
      servers: {
        srv443: {
          listen: [":443"],
          automatic_https: {
            disable: true,
          },
          routes: [myAdminApi],
          listener_wrappers: [
            {
              wrapper: "layer4",
              routes: [
                {
                  match: [
                    {
                      tls: {},
                    },
                  ],
                  handle: [
                    {
                      handler: "subroute",
                      routes: [myAdminSshForward],
                    },
                  ],
                },
              ],
            },
          ],
        },
        // redirect to https
        srv80: redirectToHttps,
      },
    },
    tls: {
      certificates: {
        automate: ["localhost", myAdminIp, myAdminDomain],
      },
      automation: {
        policies: [
          {
            "@id": "caddy_admin_tls_policy_internal",
            subjects: ["localhost", myAdminIp],
            issuers: [
              {
                module: "internal",
              },
            ],
          },
          {
            "@id": "caddy_admin_tls_policy_acme",
            subjects: [myAdminDomain],
            issuers: [
              {
                module: "acme",
              },
              {
                module: "zerossl",
              },
            ],
          },
        ],
      },
    },
  },
};
