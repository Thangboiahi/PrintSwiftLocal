// scripts/smoke-test-r1-r6.mjs
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

const results = [];
async function check(name, path, { method = 'GET', expectStatus = [200], follow = 'manual', expectRedirectTo = null } = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, { method, redirect: follow });
    const loc = res.headers.get('location') || '';
    const statusOk = expectStatus.includes(res.status);
    const redirectOk = !expectRedirectTo || loc.includes(expectRedirectTo);
    const pass = statusOk && redirectOk;
    results.push({
      pass,
      name,
      detail: `${res.status}${loc ? ` -> ${loc}` : ''}`,
    });
  } catch (err) {
    results.push({ pass: false, name, detail: err.message });
  }
}

async function run() {
  console.log(`\nRunning DD oodle R1–R6 Automated Smoke Test against ${BASE}\n`);

  // 1. Public & New Standalone Pages (R2, R3, R4)
  await check('Landing Page (/)', '/', { expectStatus: [200] });
  await check('Explore Map (/explore)', '/explore', { expectStatus: [200] });
  await check('Standalone Pick N Drop (/pick-n-drop)', '/pick-n-drop', { expectStatus: [200] });
  await check('Standalone Civic Directory (/civic)', '/civic', { expectStatus: [200] });
  await check('Standalone Vehicles Index (/vehicles)', '/vehicles', { expectStatus: [200] });
  await check('Upgraded Marketplace (/marketplace)', '/marketplace', { expectStatus: [200] });
  await check('Bulletin (/bulletin)', '/bulletin', { expectStatus: [200] });

  // 2. Legacy Alias Redirects (R2 Hygiene)
  await check('Redirect /activities -> /activity', '/activities', { expectStatus: [307, 308], expectRedirectTo: '/activity' });
  await check('Redirect /bookmarks -> /saved', '/bookmarks', { expectStatus: [307, 308], expectRedirectTo: '/saved' });
  await check('Redirect /admin -> /workspace', '/admin', { expectStatus: [307, 308], expectRedirectTo: '/workspace' });
  await check('Redirect /driver -> /workspace', '/driver', { expectStatus: [307, 308], expectRedirectTo: '/workspace' });

  // 3. Public Config API
  await check('Public Config API', '/api/config/public', { expectStatus: [200] });

  // 4. Auth-Gated APIs MUST Reject Unauthenticated Requests (401/403)
  await check('Gate: /api/system/purge-media', '/api/system/purge-media', { method: 'POST', expectStatus: [401, 403] });
  await check('Gate: /api/civic/manage', '/api/civic/manage', { method: 'GET', expectStatus: [401, 403] });
  await check('Gate: /api/bookings/walk-in-block', '/api/bookings/walk-in-block', { method: 'POST', expectStatus: [401, 403] });
  await check('Gate: /api/real-estate/freshness', '/api/real-estate/freshness', { method: 'POST', expectStatus: [401, 403] });
  await check('Gate: /api/seed', '/api/seed', { method: 'POST', expectStatus: [401, 403, 405] });

  // Print Summary
  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'} | ${r.name.padEnd(42)} | ${r.detail}`);
    if (!r.pass) failed++;
  }
  console.log(`\nSummary: ${results.length - failed}/${results.length} passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
