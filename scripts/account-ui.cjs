/* eslint-disable @typescript-eslint/no-require-imports */
/** Account form and guest-import behavior with actual component handlers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (value, label) => { assert.ok(value, label); assertions++; };
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const filename = path.resolve(__dirname, '../components/account-panel.tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function hooks() {
  const slots = []; let index = 0, effects = [];
  return {
    react: {
      useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useEffect(effect, dependencies) {
        const slot = index++, previous = slots[slot];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i]))
          effects.push(() => { previous?.cleanup?.(); slots[slot] = { dependencies, cleanup: effect() }; });
      },
    },
    render(component) { index = 0; const result = component(); const pending = effects; effects = []; pending.forEach(run => run()); return result; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).trim() === label);
const settle = () => new Promise(setImmediate);
function harness() {
  const runtime = hooks(), requests = [];
  let imports = 0, logouts = 0, retries = 0;
  const account = { user: null, status: 'guest', error: null,
    register: payload => request('register', payload), login: payload => request('login', payload) };
  const learning = {
    guestTrackCount: 2, syncStatus: 'idle', syncError: null,
    async importGuestTracks() { imports++; learning.guestTrackCount = 0; learning.syncStatus = 'saved'; },
    async logoutAccount() { logouts++; account.user = null; account.status = 'guest'; },
    async retrySync() { retries++; learning.syncStatus = 'saved'; learning.syncError = null; },
  };
  function request(action, payload) {
    return new Promise((resolve, reject) => requests.push({ action, payload, resolve, reject }));
  }
  const item = { exports: {} };
  const dependencies = {
    react: runtime.react, 'react/jsx-runtime': jsx, 'next/link': 'a', '@/components/icon': { Icon: 'Icon' },
    '@/lib/account-context': { useAccount: () => account }, '@/lib/learning-context': { useLearning: () => learning },
    './account-panel.module.css': new Proxy({}, { get: (_, key) => key }),
  };
  new Function('require', 'module', 'exports', code)(name => dependencies[name], item, item.exports);
  let tree;
  const render = () => { tree = runtime.render(() => item.exports.AccountPanel()); return tree; };
  const edit = (id, value) => { find(tree, node => node.props?.id === id).props.onChange({ target: { value } }); return render(); };
  const submit = () => find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  render();
  return { account, learning, requests, render, edit, submit, unmount: () => runtime.unmount(), get tree() { return tree; }, get imports() { return imports; }, get logouts() { return logouts; }, get retries() { return retries; } };
}

(async () => {
  const form = harness();
  equal(find(form.tree, node => node.type === 'form').props.method, 'post', 'A pre-hydration submission cannot put credentials in a URL query');
  const password = '  twelve character password  ';
  form.edit('account-name', '  Jordan  '); form.edit('account-email', '  jordan@example.com  '); form.edit('account-password', password);
  equal(find(form.tree, node => node.props?.id === 'account-password').props.autoComplete, 'new-password', 'Registration supports password managers');
  form.submit(); form.submit(); form.render();
  equal(form.requests.length, 1, 'Repeated submission starts only one account request');
  equal(form.requests[0].payload, { name: 'Jordan', email: 'jordan@example.com', password }, 'Name/email are trimmed and password spaces remain exact');
  check(find(form.tree, node => node.props?.id === 'account-password').props.disabled, 'Fields are disabled while the account request is pending');
  form.requests[0].reject(new Error('Unable to create an account right now.')); await settle(); form.render();
  equal(find(form.tree, node => node.props?.id === 'account-password').props.value, password, 'A failed submission preserves the password for retry');
  equal(find(form.tree, node => node.props?.id === 'account-email').props.value, '  jordan@example.com  ', 'A failed submission preserves the email field');
  check(text(form.tree).includes('Unable to create an account right now.'), 'The form displays the safe action error');
  form.submit();
  form.account.user = { id: 'account-1', name: 'Jordan', email: 'jordan@example.com' }; form.account.status = 'authenticated';
  form.requests[1].resolve(); await settle(); form.render();
  equal(form.imports, 0, 'Signing up does not silently import guest learning');
  check(text(form.tree).includes('jordan@example.com'), 'The signed-in account shows its email');
  const importButton = button(form.tree, 'Save this browser’s guest tracks to my account');
  check(importButton, 'Available guest learning has an explicit save action');
  importButton.props.onClick(); importButton.props.onClick(); await settle(); form.render();
  equal(form.imports, 1, 'A repeated guest-import click saves once');
  check(!button(form.tree, 'Save this browser’s guest tracks to my account'), 'The import action disappears after saving guest tracks');
  form.learning.syncStatus = 'error'; form.learning.syncError = 'Saving failed. Your local tracks are intact.'; form.render();
  button(form.tree, 'Try saving again').props.onClick(); await settle(); form.render();
  equal(form.retries, 1, 'Account settings can retry a failed progress save');
  button(form.tree, 'Sign out').props.onClick(); await settle(); form.render();
  equal(form.logouts, 1, 'Sign out calls the flush-aware learning action');
  equal(find(form.tree, node => node.props?.id === 'account-password').props.value, '', 'Sign out leaves no password in the form');
  equal(find(form.tree, node => node.props?.id === 'account-password').props.autoComplete, 'current-password', 'The return form selects sign-in with password-manager support');
  form.edit('account-email', 'jordan@example.com'); form.edit('account-password', password);
  form.submit(); equal(form.requests.at(-1).action, 'login', 'The sign-in form calls login');
  form.requests.at(-1).reject(new Error('Email or password is incorrect.')); await settle(); form.render();
  check(text(form.tree).includes('Email or password is incorrect.'), 'Login failure is displayed without clearing credentials');
  equal(find(form.tree, node => node.props?.id === 'account-password').props.value, password, 'Login failure preserves password input');
  form.unmount();

  const invalid = harness(); invalid.edit('account-name', 'Jordan'); invalid.edit('account-email', 'jordan@example.com'); invalid.edit('account-password', 'short'); invalid.submit(); invalid.render();
  equal(invalid.requests.length, 0, 'An undersized password is rejected before transport');
  invalid.account.status = 'loading'; invalid.render();
  check(text(invalid.tree).includes('Checking your sign-in'), 'Session hydration has an accessible loading state');
  check(!find(invalid.tree, node => node.type === 'form'), 'Session hydration does not display a competing account form');
  invalid.unmount();
  console.log(`PASS ${assertions} account UI assertions: guarded forms, exact passwords, retained failures, explicit guest import, progress retry, and flush-aware sign-out.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
