/* eslint-disable @typescript-eslint/no-require-imports */
/** Track selection, safe creation, and explicit deletion with real UI handlers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (value, label) => { assert.ok(value, label); assertions++; };
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../components/track-switcher.tsx'), 'utf8'), {
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
    render(component) { index = 0; const tree = component(); const pending = effects; effects = []; pending.forEach(run => run()); return tree; },
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
  const runtime = hooks(), requests = [], routes = [];
  const context = { ready: true, syncStatus: 'idle', activePathId: 'path-a', paths: [
    { id: 'path-a', title: 'SQL for customer analysis', track: 'data-science', completedModuleCount: 2, moduleCount: 6, updatedAt: '2026-10-31T12:00:00.000Z' },
    { id: 'path-b', title: 'Advanced statistics', track: 'data-science', completedModuleCount: 1, moduleCount: 8, updatedAt: '2026-10-31T13:00:00.000Z' },
  ], switchPath: id => request('switch', id), newPath: () => request('new'), deletePath: id => request('delete', id) };
  function request(action, id) { return new Promise((resolve, reject) => requests.push({ action, id, resolve, reject })); }
  const item = { exports: {} };
  const dependencies = { react: runtime.react, 'react/jsx-runtime': jsx, 'next/navigation': { useRouter: () => ({ push: route => routes.push(route) }) }, '@/components/icon': { Icon: 'Icon' }, '@/lib/learning-context': { useLearning: () => context }, './track-switcher.module.css': new Proxy({}, { get: (_, key) => key }) };
  new Function('require', 'module', 'exports', code)(name => dependencies[name], item, item.exports);
  let tree;
  const render = () => { tree = runtime.render(() => item.exports.TrackSwitcher()); return tree; };
  render();
  return { context, requests, routes, render, unmount: () => runtime.unmount(), get tree() { return tree; } };
}

(async () => {
  const tracks = harness();
  equal(nodes(tracks.tree).filter(node => node.type === 'option' && node.props.value).length, 2, 'Several saved paths within one category remain separately selectable');
  const cards = () => find(tracks.tree, node => node.props?.['aria-label'] === 'Recent learning tracks');
  equal(nodes(cards()).filter(node => node.type === 'button').length, 2, 'Saved paths also appear as visible cards');
  check(text(cards()).includes('2/6 complete') && text(cards()).includes('1/8 complete'), 'Both independent progress counts are visible together without opening a dropdown');
  check(find(cards(), node => node.type === 'button' && node.props['aria-pressed'] && text(node).includes('SQL for customer analysis')), 'The active saved path has an accessible pressed state');
  const selector = () => find(tracks.tree, node => node.type === 'select');
  equal(selector().props.value, 'path-a', 'The selector reflects the active saved path');
  find(cards(), node => node.type === 'button' && text(node).includes('Advanced statistics')).props.onClick();
  selector().props.onChange({ target: { value: 'path-b' } }); tracks.render();
  equal(tracks.requests.length, 1, 'Rapid selection changes do not duplicate an in-flight switch');
  check(selector().props.disabled, 'Selection is disabled until the current save and switch finish');
  tracks.requests[0].reject(new Error('Your current progress could not be saved.')); await settle(); tracks.render();
  equal(selector().props.value, 'path-a', 'A failed switch keeps the current path selected');
  check(text(tracks.tree).includes('Your current progress could not be saved.'), 'The reason a switch failed remains visible');
  selector().props.onChange({ target: { value: 'path-b' } });
  tracks.context.activePathId = 'path-b'; tracks.requests[1].resolve(); await settle(); tracks.render();
  equal(selector().props.value, 'path-b', 'A completed switch displays the requested path');
  check(text(tracks.tree).includes('1 of 8 modules complete'), 'Each path displays its own progress');
  find(cards(), node => node.type === 'button' && node.props['aria-pressed']).props.onClick();
  equal(tracks.requests.length, 2, 'Clicking the active path card does not start an unnecessary save or switch');
  button(tracks.tree, 'Delete this track').props.onClick(); tracks.render();
  equal(tracks.requests.length, 2, 'Opening deletion confirmation does not delete a path');
  check(text(tracks.tree).includes('quiz attempts, and progress will be removed'), 'Deletion explains exactly which saved work will be removed');
  button(tracks.tree, 'Keep track').props.onClick(); tracks.render();
  check(!button(tracks.tree, 'Delete track'), 'Keeping the path dismisses deletion confirmation');
  button(tracks.tree, 'Delete this track').props.onClick(); tracks.render();
  const remove = button(tracks.tree, 'Delete track'); remove.props.onClick(); remove.props.onClick(); tracks.render();
  equal(tracks.requests.filter(request => request.action === 'delete').length, 1, 'Repeated confirmation sends one deletion request');
  equal(tracks.requests.at(-1).id, 'path-b', 'Deletion targets the explicitly confirmed saved path');
  tracks.context.paths = tracks.context.paths.filter(path => path.id !== 'path-b'); tracks.context.activePathId = 'path-a';
  tracks.requests.at(-1).resolve(); await settle(); tracks.render();
  equal(selector().props.value, 'path-a', 'The remaining saved path becomes visible after deletion');
  const create = button(tracks.tree, 'New learning track'); create.props.onClick(); create.props.onClick(); tracks.render();
  equal(tracks.requests.filter(request => request.action === 'new').length, 1, 'Repeated creation clicks begin one fresh path');
  equal(tracks.routes, [], 'Onboarding waits until current progress has been saved');
  tracks.requests.at(-1).reject(new Error('Unable to save this path yet.')); await settle(); tracks.render();
  equal(tracks.routes, [], 'A failed save does not navigate away from the current path');
  button(tracks.tree, 'New learning track').props.onClick(); tracks.requests.at(-1).resolve(); await settle(); tracks.render();
  equal(tracks.routes, ['/onboarding'], 'A completed fresh-path action opens onboarding');
  tracks.context.ready = false; tracks.render();
  check(button(tracks.tree, 'New learning track').props.disabled && text(tracks.tree).includes('Opening your saved tracks'), 'Library hydration blocks mutations with an accessible loading state');
  tracks.unmount();
  const many = harness();
  many.context.paths = Array.from({ length: 8 }, (_, index) => ({ id: `many-${index}`, title: `Saved path ${index + 1}`, track: 'web-development', completedModuleCount: index, moduleCount: 8, updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00.000Z` }));
  many.context.activePathId = 'many-7'; many.render();
  const recent = find(many.tree, node => node.props?.['aria-label'] === 'Recent learning tracks');
  equal(nodes(recent).filter(node => node.type === 'button').length, 6, 'The compact card list shows at most six recent paths');
  equal(nodes(many.tree).filter(node => node.type === 'option' && node.props.value).length, 8, 'The dropdown still contains every saved path');
  check(text(recent).includes('Saved path 8') && !text(recent).includes('Saved path 2'), 'The visible cards prioritize the most recently updated paths');
  many.unmount();
  console.log(`PASS ${assertions} track UI assertions: same-category paths, independent progress, guarded switching, saved creation, and explicit deletion.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
