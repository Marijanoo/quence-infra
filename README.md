# QuenceInfra

Infrastructure control center, a desktop app (Electron) in the Quence family: manage your servers, open SSH terminals and watch live CPU, memory, disk and network figures from one window. Nothing is installed on the servers: everything runs over SSH.

## What it does (v0.4)

- **Servers:** add servers with a password, a private key (file or pasted, with passphrase) or your SSH agent; organise them into groups; search; duplicate; move between groups.
- **Terminals:** integrated SSH terminals (xterm.js), several per server, kept alive while you switch tabs. Ctrl+T opens another one, Ctrl+W closes the tab.
- **Live monitoring:** CPU (total and per core), load, memory and swap, disks, network traffic and the busiest processes, refreshed every 2 seconds, with the last 5 minutes charted. Linux servers (reads `/proc`).
- **Safety:** host keys are remembered on first use and a changed key blocks the connection; passwords, passphrases and pasted keys are encrypted with the system keychain (Electron safeStorage) and never go back to the UI.

- **Files (SFTP):** browse, open and edit text files (Ctrl+S), rename, delete, new folder, upload and download files or whole folders, drag files from your computer to upload.
- **Processes:** every process with CPU, memory and uptime, sort and filter, stop or force-kill from the context menu.
- **Services (systemd):** list, filter by running, failed or inactive, start, stop and restart (as root, or through `sudo` without a password).

- **Docker:** containers (state, CPU and memory, ports; start, stop, restart, pause, kill, remove, inspect, live logs, a shell inside the container), Compose stacks (up, restart, stop, pull, logs, down), images (pull, remove, prune), volumes and networks. Works for users in the docker group or with passwordless sudo.

- **Logs:** follow the system journal (the whole system or one service, filtered by level), any log file (`tail -F`) or a container's logs, live, with filter, pause, wrap and copy.

Planned next: deployments, notifications.

## Development

```
npm install
npm run electron:dev     # Next.js dev server + Electron
npm test                 # unit tests; set INFRA_TEST_SSH=<port>:<dir> to also run the tests against a real SSH server
npm run electron:build   # package for the current OS into dist/
```

Releases: bump `version` in `package.json` and in `app/page.tsx`, tag `vX.Y.Z` and push; GitHub Actions builds Windows (installer), macOS (dmg and zip, Apple silicon and Intel) and Linux (AppImage) and attaches them to the release. The builds are not code-signed, so Windows SmartScreen and macOS Gatekeeper ask for confirmation the first time.

Layout: `electron/` is the main process (SSH connections, shells, monitoring, the server store), `app/` and `components/` the interface, `electron/types.ts` the types shared between them.
