WinSCP — upload THIS folder's contents to the app server

Upload destination example:
  /var/www/Data_Quality_Tool
  or /home/<user>/Data_Quality_Tool

What is included (safe to upload):
  src/              main Next.js app
  capacity/         Capacity source (embed is already built -- see below)
  public/           static assets + the prebuilt capacity embed
  database/         SQL scripts (already used via SQLyog)
  data/             empty folders for uploads/processed (must be writable)
  package.json, package-lock.json, next.config.ts, tsconfig.json, ...
  .env.production.example   ← copy to .env.local on the server (PuTTY)
  SERVER-SETUP.txt          ← PuTTY steps
  server-commands.sh        ← optional install/build script

What is NOT included (do not add from your PC):
  node_modules/
  .next/
  .env / .env.local / capacity/.env
  .env.example   (intentionally omitted -- would force JSON/demo mode)
  .git/

Before WinSCP: finish SQLyog scripts in order
  001 → 002 → 004 → 005 → 006 → 007 → 008 → 010 → 003
  (009 is the exception: run it only after the new build is serving traffic.)

The capacity embed under public/capacity/ is already built, so the server does
not need capacity's build tools. Upload public/ as-is -- do not skip it.

After upload, use PuTTY:
  - Follow SERVER-SETUP.txt in this folder.

Critical on the server:
  cp .env.production.example .env.local
  (then edit DB_* credentials; COOKIE_SECURE=false for HTTP)
