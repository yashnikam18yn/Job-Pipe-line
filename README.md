# Role Radar Outreach

A personal job-search and outreach dashboard for Yash Nikam.

## Use the app

Open **https://role-radar-outreach.lovable.app** and sign in with your existing account from any laptop. No download or installation is needed to use the published app.

## What it includes

- Recent LinkedIn and Naukri job discovery with keyword and experience filters.
- Company contact discovery, with inferred addresses clearly marked as likely rather than verified.
- An editable review queue before sending outreach through Gmail with a resume.
- Sent-email activity, bounce checks, and open/resume-link tracking.
- Excel, CSV, and PDF imports for internal company and HR data.
- Saved settings and an in-app setup guide.

Uploaded list emails teach company email patterns by default. Direct use requires explicit permission. Tracking and the absence of a bounce do not prove delivery or a human read.

## Run the code locally

Install a current Node.js LTS release and Bun, then run:

```sh
git clone https://github.com/yashnikam18yn/Job-Pipe-line.git
cd Job-Pipe-line
bun install
bun run dev
```

Open the local address printed in your terminal.

**Configuration:** The published app uses Lovable Cloud and connected services. Cloning this repository does not copy private credentials, recreate the hosted configuration, or start scheduled outreach on your laptop. Server-only service credentials must be configured separately; never commit them to GitHub. Use the published app for the already-configured experience.

## Tests

```sh
bun run test
```

## Technology

React, TypeScript, TanStack Start, Tailwind CSS, and Lovable Cloud.

## Repository updates

This repository was uploaded as a snapshot. Future edits are not automatically synchronized unless Git sync is separately configured. The published app and this code repository serve different purposes: the app is for daily use; the repository is for source code and development.
