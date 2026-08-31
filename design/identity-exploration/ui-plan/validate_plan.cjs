/* Offline inventory/template checks. This does not launch or emulate a browser. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = __dirname;
const repo = path.resolve(root, '../../..');
const dataSource = fs.readFileSync(path.join(root, 'pages.js'), 'utf8');
const previewSource = fs.readFileSync(path.join(root, 'preview.js'), 'utf8');
const dataContext = vm.createContext({ window: {} });
new vm.Script(dataSource).runInContext(dataContext);
const pages = dataContext.window.KALL_PLAN.pages;
function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(full) : entry.name === 'page.tsx' ? [full] : [];
  });
}
const app = path.join(repo, 'apps/web/app');
const routes = routeFiles(app).map(file => '/' + path.relative(app, path.dirname(file)).split(path.sep).filter(Boolean).join('/')).sort();
assert.deepEqual(Array.from(pages, p => p.route).sort(), routes, 'Every current route must be represented once');
assert.equal(pages.length, 40);
assert.equal(new Set(pages.map(p => p.id)).size, 40);
const viewKeys = new Set();
for (const page of pages) {
  for (const key of ['name','route','group','view','question','action','sections','guard','mobile','empty']) {
    assert.equal(typeof page[key], 'string', `${page.id}: missing ${key}`);
    assert.ok(page[key].length > 0);
  }
  // Evaluate only the pure template definitions, before any DOM write or event binding.
  const context = vm.createContext({ URLSearchParams, location: { search: `?page=${page.id}` }, KALL_PLAN: dataContext.window.KALL_PLAN });
  new vm.Script(previewSource.slice(0, previewSource.indexOf('document.title='))).runInContext(context);
  const html = vm.runInContext('stateView()', context);
  assert.ok(html.includes('<h1>'), `${page.id}: heading missing from template`);
  assert.ok(!html.includes('undefined'), `${page.id}: unresolved template value`);
  for (const key of vm.runInContext('Object.keys(views)', context)) viewKeys.add(key);
}
const expectedRedirects = {
  '/opportunities':'/search?tab=discovery','/jobs':'/search?tab=discovery','/sources':'/search?tab=sources',
  '/profile':'/settings/identity','/profile-details':'/profiles?tab=record','/growth':'/profiles?tab=growth',
  '/intelligence':'/profiles?tab=achievements','/testimonials':'/profiles?tab=references',
  '/documents':'/resumes?tab=generate','/resume-intelligence':'/resumes?tab=intelligence','/tailoring':'/resumes?tab=tailoring',
  '/apply':'/applications/new + existing query','/application-review':'/applications','/submissions':'/applications','/setup':'/profiles'
};
for (const [route, destination] of Object.entries(expectedRedirects)) {
  assert.equal(pages.find(p => p.route === route).redirect, destination);
  const file = path.join(app, route.slice(1), 'page.tsx');
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes(destination.split(' + ')[0]), `${route}: source redirect changed`);
}
for (const filename of ['pages.js','preview.js','plan.js','index.html','preview.html','preview.css','plan.css','README.md']) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  assert.ok(!source.includes('\u2014'), `${filename}: em dash`);
  if (filename.endsWith('.js')) new vm.Script(source);
}
const coverage = {
  status:'ui_plan_for_review',identity:'Inscription selected',sourceCommit:'3ecb862f8a6a8be6ce8548c42e175d40f4330f3e',
  routeCount:pages.length,compatibilityRouteCount:pages.filter(p=>p.redirect).length,templateCount:viewKeys.size,
  validation:'Offline route inventory and template evaluation only. New browser visual review blocked by browser URL policy.',
  routes:pages,views:Array.from(viewKeys)
};
fs.writeFileSync(path.join(root, 'coverage.json'), JSON.stringify(coverage,null,2)+'\n');
console.log(`PASS: ${pages.length} routes, ${coverage.compatibilityRouteCount} preserved redirects, ${viewKeys.size} page/subview templates.`);
console.log('JavaScript parses; all route metadata and default templates resolve. This is not browser or visual QA.');
