# 🏗️ infrasnap

[![CI](https://github.com/YOUR_USERNAME/infrasnap/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/infrasnap/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![GitHub Achievements](https://img.shields.io/badge/GitHub-Achievements-blueviolet.svg)](https://github.com/YOUR_USERNAME)

> Snapshots and diffs infrastructure configuration files over time — know exactly what changed, when, and by how much.

## ✨ Features

- 📸 Snapshot any directory of config files (YAML, JSON, TOML, .env, Terraform, Dockerfiles, nginx.conf, and more)
- 🔍 Diff working tree vs last snapshot with line-level changes
- 🌍 Multi-environment support: `--env production`, `--env staging`
- 👁️ Watch mode — automatically snapshot when changes are detected
- 💾 Export diff reports as JSON for audit trails

## 🚀 Quick Start

```bash
npm install
node src/infrasnap.js snapshot .
# make changes ...
node src/infrasnap.js diff .
```

## 📖 Usage

```bash
node src/infrasnap.js snapshot [path] [--env name] [--label text]
node src/infrasnap.js diff [path] [--env name] [--out file]
node src/infrasnap.js list
node src/infrasnap.js watch [path] [interval-sec] [--env name]
```

## 🏆 Achievement Scripts

```bash
bash scripts/setup.sh
bash scripts/unlock-all.sh
```
