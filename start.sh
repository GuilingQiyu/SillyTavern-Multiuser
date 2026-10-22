#!/usr/bin/env bash

if ! command -v npm &> /dev/null
then
    echo "npm is not installed. Please install Node.js and npm"
    exit 1
fi

# Navigate to the script's directory
cd "$(dirname "$0")" || exit 1
export NODE_ENV=production

npm install --no-save --no-audit --no-fund --loglevel=error --no-progress --omit=dev --ignore-scripts

echo "Entering SillyTavern..."

min_delay_seconds=5
max_delay_seconds=60
healthy_uptime_seconds=60
restart_delay_seconds=${min_delay_seconds}
log_file=~/STLog/SillyTavern_$(date +%Y%m%d_%H%M%S).log

mkdir -p ~/STLog

trap 'echo "Stopping SillyTavern restart loop..."; exit 0' INT TERM

while true
do
    start_ts=$(date +%s)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting SillyTavern server..." | tee -a "$log_file"
    node "server.js" "$@" 2>&1 | tee -a "$log_file"
    exit_code=${PIPESTATUS[0]}
    end_ts=$(date +%s)
    uptime_seconds=$((end_ts - start_ts))

    if [ "${uptime_seconds}" -ge "${healthy_uptime_seconds}" ]; then
        restart_delay_seconds=${min_delay_seconds}
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SillyTavern exited with code ${exit_code} after ${uptime_seconds}s. Restarting in ${restart_delay_seconds} seconds..." | tee -a "$log_file"
    sleep "${restart_delay_seconds}"

    restart_delay_seconds=$((restart_delay_seconds * 2))
    if [ "${restart_delay_seconds}" -gt "${max_delay_seconds}" ]; then
        restart_delay_seconds=${max_delay_seconds}
    fi
done
