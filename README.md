# router-metrics-monitor

## What this project does

Periodically collects runtime metrics from a home router (OpenWrt / iStoreOS),
stores them in a GitHub repository, and renders them as zoomable line charts on
a web page (deployed on Vercel) — making it easy to observe network load
patterns and spot anomalies.

The collector runs on an always-on Windows PC and reads router data over SSH in
read-only mode (nothing is installed on the router itself): it collects once per
minute and performs a local `git commit`, then pushes to the remote once per day.

## Which metrics are collected

Each collection captures three metrics, stored monthly as `data/YYYYMM.json`,
with each record being `[unix_seconds, active_connections, down_B/s, up_B/s]`:

| Metric | Description | Source |
|--------|-------------|--------|
| Active connections | Total connections tracked by kernel conntrack | `/proc/sys/net/netfilter/nf_conntrack_count` |
| Download speed | WAN port real-time download rate | delta of `/sys/class/net/<wan>/statistics/rx_bytes` |
| Upload speed | WAN port real-time upload rate | delta of `/sys/class/net/<wan>/statistics/tx_bytes` |

## Deploy the collector (Windows)

**Requirements**: Node.js, plink (`choco install putty.portable`), git.

```powershell
# 1. Configure
Copy-Item .env.example .env      # then edit .env with router address/password/WAN interface, etc.
git remote add origin https://<username>:<token>@github.com/<username>/router-metrics-monitor.git

# 2. Test once manually
node scripts\router-metrics-collect.js    # prints: collected ... committed
node scripts\git-push.js                  # prints: pushed OK

# 3. Register as scheduled tasks (collect every minute, push daily at 04:00); runs automatically once installed
powershell -ExecutionPolicy Bypass -File init\install-cronjob-windows.ps1

# Uninstall
powershell -ExecutionPolicy Bypass -File init\uninstall-cronjob-windows.ps1
```

Customize frequency: `install-cronjob-windows.ps1 -CollectMinutes 5 -PushAt 03:30`
Runtime logs are in `logs\collect.log` and `logs\push.log`.

## View locally

The frontend uses `fetch` to read `data/`, so you need a static server (you
cannot just double-click the file to open it):

```powershell
py -m http.server 3000
```

Then open <http://127.0.0.1:3000> in your browser. (For production, use the
address deployed on Vercel.)
