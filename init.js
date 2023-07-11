"use strict";

let Caddy = module.exports;

const LOCALHOST = "localhost";
const CADDY_API_HOST = "localhost:2019";
const CADDY_LOCAL_SSH = "localhost:22";

Caddy.init = function (admin) {
  let myDebugLevel = admin.debug_level;
  if (!myDebugLevel) {
    // TODO check allowed strings
    myDebugLevel = "INFO";
  }

  // admin.hostname = "sni.m.example.com";
  // admin.internal_ip = "192.168.1.10";

  let myAdminSshForward = {
    match: [
      {
        tls: {
          sni: [admin.hostname],
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
                    dial: [CADDY_LOCAL_SSH],
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
                    host: [admin.hostname],
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
        host: [admin.hostname],
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
                      Host: [CADDY_API_HOST],
                    },
                  },
                },
                upstreams: [
                  {
                    dial: CADDY_API_HOST,
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

  return {
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
          automate: [LOCALHOST, admin.internal_ip, admin.hostname],
        },
        automation: {
          policies: [
            {
              "@id": "caddy_admin_tls_policy_internal",
              subjects: [LOCALHOST, admin.internal_ip],
              issuers: [
                {
                  module: "internal",
                },
              ],
            },
            {
              "@id": "caddy_admin_tls_policy_acme",
              subjects: [admin.hostname],
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
};
