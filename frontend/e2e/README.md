# Frontend E2E tests

Playwright tests for the DukaPay web app. They run against the Next.js dev
server with **no backend**: every API call a test needs is mocked with
`page.route`, and a connected wallet is simulated by seeding the
`dukapay-wallet` entry in `localStorage` before the page loads.

## Running

```bash
cd frontend
npx playwright install chromium     # once
npx playwright test --project=chromium
npx playwright test e2e/send-remittance.spec.ts --project=chromium --debug
```

Playwright starts `npm run dev` itself (see `playwright.config.ts`). Locally it
reuses a server already running on port 3000.

CI runs the chromium project in the `e2e` job of `.github/workflows/ci.yml`.
A weekly job in `.github/workflows/e2e-tests.yml` runs all browsers.

## Writing a test

- Test features that exist. Find the real text, labels and routes in
  `frontend/src` and `frontend/messages/en.json` before writing a locator.
- Mock the response shape the backend really returns
  (`backend/src/controllers`). A mock in the wrong shape makes a test pass
  while the real app breaks.
- Prefer `getByRole` and `getByLabel` over CSS selectors.
- Don't skip or loosen a failing test to make it pass. Fix the cause, or ask
  the maintainer if the feature changed on purpose.

## Support

Ask questions in [GitHub Issues](https://github.com/ExcelDsigN-tech/dukapay/issues).
