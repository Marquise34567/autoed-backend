# autoed-backend-ready (notes)

Bucket CORS for browser PUTs

Browsers require the GCS bucket to have a CORS configuration that allows the frontend origin to perform PUT/POST requests to V4 signed URLs. Without this, uploads from the browser will be blocked by GCS.

To set the bucket CORS locally (requires service account with storage.admin or storage.buckets.update):

1) Export env vars (either the JSON string or a local path):

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content -Raw .\service-account.json
$env:FIREBASE_STORAGE_BUCKET = 'your-bucket-name'
```

2) Run the helper script to apply CORS:

```powershell
npm install
npm run set:gcs:cors
```

This will apply a CORS config allowing the following origins:
- https://autoeditor.app
- https://www.autoeditor.app
- https://*.vercel.app

And methods: GET, HEAD, PUT, POST, DELETE, OPTIONS

Verification

After applying CORS, you can run the end-to-end test which requests a signed URL from the local backend and attempts a PUT:

```powershell
# point BACKEND_URL if your server isn't on localhost:8080
$env:BACKEND_URL = 'http://localhost:8080'
npm run test:signed-put
```

Railway env vars to set before redeploy

- `FIREBASE_SERVICE_ACCOUNT_JSON` — paste the JSON service account contents as a single-line value (or store as a secret file in CI and reference). This is used only to run the CORS script locally; Railway should have the service account configured for the running app already.
- `FIREBASE_STORAGE_BUCKET` — the bucket name (e.g., `autoeditor-d4940.appspot.com` or `autoeditor-d4940.appspot.com/path`); the script will normalize to the bucket name.

After setting these, redeploy the app so the running instance has access to the service account and storage bucket.
