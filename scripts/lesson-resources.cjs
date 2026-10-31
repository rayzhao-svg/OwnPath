/* eslint-disable @typescript-eslint/no-require-imports */
/** Offline checks for useful reading on new and previously cached lessons. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/lesson-resources.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const item = { exports: {} };
new Function('exports', 'module', output)(item.exports, item);
const { resourcesForLesson } = item.exports;
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
const savedSource = { id: 'saved', title: 'CS50 SQL', provider: 'Harvard University', url: 'https://cs50.harvard.edu/sql/', type: 'course' };
function context(title, topics = [], resources = []) {
  const lesson = { id: 'lesson', moduleId: 'module', title, slides: [{ id: 'slide', title, bullets: topics, narration: 'Saved teaching content.' }], quiz: [] };
  const learningModule = { id: 'module', title, topics, description: title, resources, prerequisites: [], estimatedDuration: 45, status: 'in-progress' };
  return { lesson, learningModule };
}
function reading(title, topics, track, resources = []) {
  const { lesson, learningModule } = context(title, topics, resources);
  const before = JSON.stringify({ lesson, learningModule });
  const result = resourcesForLesson(lesson, learningModule, track);
  check(result.length >= 4 && result.length <= 5, `${title}: four or five distinct readings`);
  check(new Set(result.map(r => r.url.replace(/\/$/, ''))).size === result.length, `${title}: no repeated URLs`);
  check(result.every(r => new URL(r.url).protocol === 'https:'), `${title}: HTTPS only`);
  check(result.every(r => r.id && r.title && r.provider && ['documentation', 'course', 'article', 'video'].includes(r.type)), `${title}: complete resource metadata`);
  check(JSON.stringify({ lesson, learningModule }) === before, `${title}: saved lesson and module are untouched`);
  return result;
}
const sql = reading('SQL for Customer Analysis', ['SQL queries', 'LEFT JOIN', 'GROUP BY'], 'data-science', [savedSource]);
check(sql[0].id === savedSource.id && sql[0].title === savedSource.title, 'A cached course is preserved first');
check(sql.some(r => r.url.endsWith('/tutorial-join.html')), 'SQL lesson adds a focused joins reading');
check(sql.some(r => r.url.endsWith('/tutorial-agg.html')), 'SQL lesson adds a focused aggregates reading');
check(!sql.some(r => r.provider === 'React'), 'SQL lesson excludes unrelated React readings');
const python = reading('Python Foundations for Spreadsheet Analysts', ['Variables and loops', 'Functions', 'Reading CSV'], 'data-science');
check(python.some(r => r.url.endsWith('/library/csv.html')), 'Python CSV lesson includes CSV documentation');
check(python.some(r => r.url.endsWith('/controlflow.html')), 'Python lesson includes control-flow documentation');
const cleaning = reading('Make sense of messy data', ['DataFrames', 'Missing values', 'Data cleaning'], 'data-science');
check(cleaning.some(r => r.url.endsWith('/missing_data.html')), 'Cleaning lesson includes missing-data guide');
const stats = reading('Statistics that tell a story', ['Mean & median', 'Variation', 'Sampling'], 'data-science');
check(stats.some(r => r.provider === 'SciPy'), 'Statistics lesson includes statistical tools');
const charts = reading('Explore, visualize, discover', ['Exploratory analysis', 'Chart selection', 'Communication'], 'data-science');
check(charts.some(r => r.provider === 'Matplotlib') && charts.some(r => r.provider === 'seaborn'), 'Charts lesson includes focused plotting references');
const model = reading('Your first predictive model', ['Features & targets', 'Train/test split', 'Model evaluation'], 'data-science');
check(model.some(r => r.url.endsWith('/model_evaluation.html')), 'Model lesson includes evaluation reference');
const react = reading('Think in React', ['Components', 'Props', 'State'], 'web-development');
check(react.some(r => r.url === 'https://react.dev/learn/thinking-in-react'), 'React lesson includes its official worked tutorial');
const css = reading('Layouts that adapt', ['Box model', 'Flexbox & grid', 'Responsive design'], 'web-development');
check(css.some(r => r.url.endsWith('/Web/CSS')), 'Layout lesson includes CSS docs');
const research = reading('Listen before you design', ['Interviews', 'Observation', 'Synthesis'], 'product-design');
check(research.some(r => r.url === 'https://www.gov.uk/service-manual/user-research'), 'Research lesson includes research methods');
const accessible = reading('Make the experience work for more people', ['Contrast', 'Keyboard access', 'Inclusive interaction'], 'product-design');
check(accessible.some(r => r.url === 'https://www.w3.org/WAI/tutorials/'), 'Inclusive lesson includes accessibility tutorials');
const prototype = reading('Prototype, test, refine', ['Prototyping', 'Usability testing', 'Iteration'], 'product-design');
check(prototype.some(r => r.title === 'Prototyping') && prototype.some(r => r.title === 'User testing'), 'Prototype lesson includes both practice and evaluation');
const generic = reading('A new topic', [], 'product-design');
check(generic.every(r => r.provider !== 'Python'), 'Unrecognized design topic uses design foundations');
const existing = { id: 'original', title: 'My Python reading', provider: 'Python', url: 'https://docs.python.org/3/tutorial', type: 'documentation' };
const deduped = reading('Python loops', ['Functions'], 'data-science', [existing]);
check(deduped.filter(r => r.url.includes('/3/tutorial') && !r.url.includes('controlflow')).length === 1, 'Trailing slash variants are deduplicated');
check(deduped[0].title === existing.title, 'Deduplication preserves existing metadata');
const unsafe = reading('Python loops', ['Functions'], 'data-science', [{ ...existing, url: 'javascript:alert(1)' }]);
check(!unsafe.some(r => r.id === existing.id), 'Unsafe imported URLs are excluded');
const many = reading('Python loops', ['Functions'], 'data-science', Array.from({ length: 7 }, (_, i) => ({ ...existing, id: `saved-${i}`, url: `https://docs.python.org/3/tutorial/?reading=${i}` })));
check(many.length === 5, 'Long saved reading lists stay bounded');
console.log(`PASS ${checks} lesson resource assertions: topical readings, cached lessons, preservation, deduplication, safe URLs, and all learning tracks.`);
