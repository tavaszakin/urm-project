---
name: run-urmwebpage
description: Start the URM flow-diagram generator frontend and backend servers
---

# Run URM Flow-Diagram Generator

This skill starts both the FastAPI backend (port 8000) and Vite frontend dev server (port 5173) for the URM computability visualization tool. The app is a browser-driven web application; the driver script handles dependency installation, server launch, and readiness verification.

## Prerequisites

- Python 3.7+ and pip
- Node.js 18+ and npm
- macOS or Linux (tested on macOS 12+)

No additional system packages required; all dependencies are installable via pip and npm.

## Build

Install dependencies (one-time setup, included in the agent driver):

```bash
# Python dependencies (FastAPI backend)
pip install fastapi uvicorn

# Node dependencies (React frontend)
cd urmwebpage/frontend
npm install
```

## Run (agent path)

Use the driver script to launch both servers and verify they are ready:

```bash
bash urmwebpage/.claude/skills/run-urmwebpage/driver.sh
```

The script will:
1. Install missing Python and Node dependencies
2. Start the FastAPI backend on `http://localhost:8000/`
3. Start the Vite frontend on `http://localhost:5173/`
4. Wait up to 30 seconds for both servers to be ready
5. Report the URLs where the app is accessible

If servers are already running on those ports, the script skips relaunch and verifies they're responding.

**Output:**
- Backend API docs: `http://localhost:8000/docs`
- Frontend app: `http://localhost:5173/`
- Log files: `/tmp/urm-backend.log`, `/tmp/urm-frontend.log`

## Run (human path)

Two separate terminals (frontend and backend run indefinitely):

```bash
# Terminal 1: Backend API
cd urmwebpage
python3 -m uvicorn main:app --reload

# Terminal 2: Frontend dev server
cd urmwebpage/frontend
npm run dev
```

Then navigate to `http://localhost:5173/` in your browser.

## Test

Run the project's test suite (if applicable):

```bash
cd urmwebpage
python3 -m pytest
```

## Gotchas

- **Dependency installation:** First run is slow (npm install can take 30–60s). Subsequent runs are instant if dependencies cache exists.
- **Port conflicts:** If port 5173 or 8000 are in use, the script will fail gracefully. Kill the conflicting process or change the port in the script.
- **Loose Python environment:** The project does not use a virtualenv by default. If you have conflicting global packages, consider running `pip install --user` or creating a venv.
- **Vite HMR:** The frontend dev server uses hot-module replacement; changes to React files auto-reload in the browser.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ModuleNotFoundError: No module named 'fastapi'` | Run `pip install fastapi uvicorn` |
| `npm: command not found` | Install Node.js (https://nodejs.org/) |
| `Port 5173 already in use` | Kill the process: `lsof -i :5173 \| awk 'NR==2 {print $2}' \| xargs kill -9` |
| `Port 8000 already in use` | Kill the process: `lsof -i :8000 \| awk 'NR==2 {print $2}' \| xargs kill -9` |
| `Frontend loads but shows blank page` | Check browser console for errors; ensure backend is running (`curl http://localhost:8000/docs`) |
| `Backend startup hangs` | Check `/tmp/urm-backend.log` for Uvicorn startup errors |
