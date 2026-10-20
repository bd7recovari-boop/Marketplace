# Aurevia marketplace

Aurevia is a vanilla HTML/CSS/JavaScript frontend backed by Supabase Auth, PostgreSQL Row Level Security, and private Storage buckets. New listings default to `pending`; the public search/detail routes only return approved listings. Exact street addresses and ownership/authority evidence are private to the listing owner and authorized administrators.

## Supabase setup

1. Create a Supabase project and keep its database password private.
2. In the Supabase SQL Editor, run `supabase/migrations/001_marketplace.sql` once. This creates the profile/listing/review tables, RLS policies, review RPCs, and two private Storage buckets.
3. In Authentication settings, configure the site URL and redirect URLs for your local URL and production domain. Enable email verification before production.
4. In Authentication → Emails → SMTP Settings, configure a verified custom sender (for example, Resend) before expecting verification emails to reach ordinary users. Supabase's default SMTP is for testing, is rate-limited, and only delivers to project team addresses. Set the provider host, port, username, password, and a sender address on your verified domain in Supabase; do not put SMTP credentials in the website or GitHub. Verify the provider's SPF/DKIM instructions and test a confirmation email.
5. Run the site, create your own account, then promote that account to administrator in the SQL Editor:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'your-admin-email@example.com';
```

6. Configure the frontend with the **project URL** and **publishable/anon key only**. Never place a service-role key in browser code or `js/config.local.js`.

For local development, set the two exported values in the ignored `js/config.local.js` file. For Vercel, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as project environment variables; `/api/config` exposes only those public values to the frontend.

## Run locally

Serve this folder over HTTP so browser ES modules work. From PowerShell in the project folder:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. The local HTTP server does not run the Vercel API function, so local development reads ignored `js/config.local.js` instead. Without valid Supabase configuration the pages show a setup message and do not claim that submissions or searches succeeded.

## Review workflow

- A verified owner or agent with a contact phone submits listing details, at least one property image, a private street address, private evidence of ownership or authority to list, and separate survey-plan/address evidence. Photos are resized and re-encoded as WebP before upload to strip embedded image metadata.
- The database forces the listing to `pending`, regardless of client input.
- Sign in with the bootstrapped admin account and open `admin.html`. Review the submitted location, phone, images, and private evidence; confirm claims through the relevant land registry, survey records, owner/agent mandate, and qualified local professionals.
- Approve or reject in the review desk. Rejection requires a reason; owners see that reason in their dashboard and can edit/resubmit.
- Only approved listings and their images are searchable. The owner's phone is shown on a public listing only after the owner opts in under profile settings.

The app enforces submission status, ownership, admin permissions, private document access, and public visibility in database functions and RLS. Human review is still required: uploading a document is not proof that it is genuine, and this project does not automatically verify Nigerian title or survey records.

## Deployment

This is a static HTML/CSS/JavaScript project; Vercel serves the HTML files directly and deploys `api/config.js` as a serverless function. No frontend build command or output directory is needed. `vercel.json` adds basic browser security headers.

The current workspace has no Git repository/remote and no Vercel CLI, so it has not been published from this machine. To deploy through the Vercel dashboard:

1. Create a GitHub repository and push this project. `.gitignore` already excludes `js/config.local.js` and environment files.
2. In Vercel, choose **Add New → Project**, import that repository, and keep the root directory as `./`.
3. Choose **Other** as the framework preset. Leave the build/install commands blank and set the output directory to `.` if Vercel asks for one.
4. In Project Settings → Environment Variables, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` for Production, Preview, and Development as appropriate. Use the Supabase project URL and publishable/anon key only. Never add the service-role key.
5. Deploy, then visit `https://YOUR-DOMAIN/api/config`. A successful response contains only the public project URL and anon key; a 503 means an environment variable is missing. Redeploy after changing environment variables.
6. In Supabase Authentication → URL Configuration, set the Site URL to the production domain and allow `https://YOUR-DOMAIN/account.html` as a redirect URL. Add your localhost URL and any preview URLs you intend to use.
7. Register your administrator account, then add its user ID to `public.admin_users` using the SQL statement in the Supabase setup section.

Verify the deployed home, account, dashboard, admin, and property routes. Until the Supabase migration and environment variables are configured, the app will show setup messages rather than accepting live submissions.

## Security smoke tests

Run these against a non-production Supabase project using separate guest, buyer, owner, and administrator sessions:

- As a guest, confirm search returns approved properties only; direct queries for pending/rejected IDs return no row, and `property_private_details` / verification-document reads are denied.
- As a buyer, confirm inserting or updating a listing, changing `account_type`, reading another profile, calling admin RPCs, and signing private documents all fail.
- As owner A, submit a listing and verify its status is `pending`; confirm owner B cannot read or change it, and owner A cannot set its own status to `approved`.
- Confirm owner A cannot access another owner's image/document paths; confirm an approved listing's public images work but its verification documents and exact address remain private.
- As admin, confirm the queue shows private address and signed evidence; approve a complete listing, reject another with a reason, verify the reason is owner-only, and confirm an admin cannot approve their own listing.
- Suspend an owner and confirm they cannot submit/edit listings and their approved listings are hidden from public search; reinstate and verify access returns.

## Current validation limits

The workspace has no Supabase project credentials, PostgreSQL client, or Supabase CLI. The migration has not been applied to a database, and end-to-end auth, uploads, RLS, review, and search are not verified against a live project yet. Apply it first to a fresh Supabase project and test with separate buyer, owner, and admin accounts before production.
