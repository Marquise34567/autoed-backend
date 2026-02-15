# autoed-backend-ready (notes)

Bucket CORS for browser PUTs

Browsers require the GCS bucket to have a CORS configuration that allows the frontend origin to perform PUT/POST requests to V4 signed URLs. Without this, uploads from the browser will be blocked by GCS.

To set the bucket CORS locally (requires service account with storage.admin or storage.buckets.update):

1) Export env vars (use split service account env vars or rely on Application Default Credentials):

```powershell
# Option A: provide split service account values
$env:FIREBASE_PROJECT_ID = 'your-project-id'
$env:FIREBASE_CLIENT_EMAIL = 'service-account@your-project.iam.gserviceaccount.com'
$env:FIREBASE_PRIVATE_KEY = (Get-Content -Raw .\service-account.json) -replace "\n", "\\n"
$env:FIREBASE_STORAGE_BUCKET = 'your-bucket-name'

# Option B: rely on Application Default Credentials (gcloud auth application-default login or CI-provided credentials)
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

- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — preferred: split service account values. For `FIREBASE_PRIVATE_KEY`, paste the key with escaped newlines (replace real newlines with `\\n`) when setting via Railway UI.
- `FIREBASE_STORAGE_BUCKET` — the bucket name (e.g., `autoeditor-d4940.appspot.com` or `autoeditor-d4940.appspot.com/path`); the script will normalize to the bucket name.

After setting these, redeploy the app so the running instance has access to the credentials and storage bucket.

Manual gsutil method (recommended if you manage buckets directly)

1) Create a `cors.json` file with the following content:

```json
[
	{
		"origin": ["https://autoeditor.app", "https://www.autoeditor.app", "https://autoeditor.app/editor"],
		"method": ["GET", "HEAD", "PUT", "POST", "DELETE", "OPTIONS"],
		"responseHeader": ["Content-Type", "x-goog-resumable", "x-goog-meta-*"],
		"maxAgeSeconds": 3600
	}
]
```

2) Run the gsutil command (replace `YOUR_BUCKET_NAME`):

```bash
gsutil cors set cors.json gs://YOUR_BUCKET_NAME
```

3) Verify the CORS configuration:

```bash
gsutil cors get gs://YOUR_BUCKET_NAME
```

Notes:
- The CORS must allow `PUT` and `OPTIONS` so the browser can send preflight requests for V4 signed PUT uploads.
- If you use a bucket path prefix, CORS is set at the bucket level (not per-path).
