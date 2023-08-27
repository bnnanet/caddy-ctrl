# caddy-ctrl

Our config tools for making idempotent updates to Caddy JSON config

https://caddyserver.com/docs/json/

```sh
vi ./admin.json
vi ./site.json
./bin/caddy-ctrl.js > ./caddy.load.json

rsync -avhPz ./caddy.load.json caddy-server:~/
```

```sh
my_file='./caddy.load.json'
curl -X POST "http://localhost:2019/load" \
	-H "Content-Type: application/json" \
	-d @"${my_file}"
```
