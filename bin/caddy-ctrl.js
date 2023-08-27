#!/usr/bin/env node
"use strict";

let Caddy = require("../add.js");
Caddy.init = require("../init.js").init;

let admin = require("../admin.json");
let sites = require("../sites.json");

async function main() {
  let config = Caddy.init(admin);
  for (let site of sites) {
    Caddy.addTls(config, site);
    Caddy.addSshProxy(config, site);
    Caddy.addHttpProxy(config, site);
  }

  let str = JSON.stringify(config, null, 2);
  console.info(str);
}

main().catch(function (err) {
  console.error(err.stack || err);
});
