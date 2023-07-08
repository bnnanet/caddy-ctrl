"use strict";

let Caddy = module.exports;

Caddy.init = {
  admin: {
    config: {
      persist: true,
    },
  },
  logging: {
    logs: {
      default: {
        level: "'${my_debug_level}'",
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
          routes: [
            {
              match: [
                {
                  host: ["'${my_admin_domain}'"],
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
            },
          ],
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
                      routes: [
                        {
                          match: [
                            {
                              tls: {
                                sni: ["'${my_admin_domain}'"],
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
                                          host: ["'${my_admin_domain}'"],
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
                    },
                  ],
                },
              ],
            },
          ],
        },
        srv80: {
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
        },
      },
    },
    tls: {
      certificates: {
        automate: ["localhost", "'${my_admin_ip}'", "'${my_admin_domain}'"],
      },
      automation: {
        policies: [
          {
            "@id": "caddy_admin_tls_policy_internal",
            subjects: ["localhost", "'${my_admin_ip}'"],
            issuers: [
              {
                module: "internal",
              },
            ],
          },
          {
            "@id": "caddy_admin_tls_policy_acme",
            subjects: ["'${my_admin_domain}'"],
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
