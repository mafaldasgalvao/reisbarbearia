# Painel da Reis Barbearia

A small dashboard where the shop edits services, photos, reviews and contacts. They sign in with their email and a one-time code, and never see GitHub.

- **Login:** Cloudflare Access emails a code to approved addresses. The Worker also verifies Access's signed token on every request, so nothing is served without one.
- **Saving:** the Cloudflare Worker validates the content and commits it to GitHub. Each save is one commit, so it publishes the site once.
- **What can be edited:** `public/admin/schema.js` defines the forms and the validation rules. To add a field, add it there and use it in `src/index.njk`.

## Try it locally
```bash
cd admin
npm install
npm run dev
```
Open `http://localhost:8788/admin/`. It uses a fake GitHub and fake login, keeps changes in memory, and touches nothing real. No accounts are needed.

Run the tests with `npm test`.

## Going live
You need a free Cloudflare account.

1. **GitHub token:** create a fine-grained token limited to the `reisbarbearia` repository, with **Contents: Read and write** only.
2. **Publish the Worker:**
   ```bash
   cd admin
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN
   ```
3. **Set up Access:** in Cloudflare, go to **Workers & Pages → reis-barbearia-painel → Settings → Domains & Routes**, and turn on **Cloudflare Access** for the `workers.dev` address. Allow only the shop's email addresses, and use **One-time PIN** as the login method.
4. **Connect the Worker to Access:** copy the team domain and the **Application Audience (AUD) Tag** into `wrangler.toml` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, then run `npx wrangler deploy` again.

Until step 4 is done, the Worker refuses every request.

Saves go to the branch in `GITHUB_BRANCH`, in `wrangler.toml`. The site is published from `main`.

## Managing access
Add or remove people in the Cloudflare Access policy. No code changes are needed.
