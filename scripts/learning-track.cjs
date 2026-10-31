/* eslint-disable @typescript-eslint/no-require-imports */
/** Offline checks for routing goal input into the supported curricula. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/learning-track.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const item = { exports: {} };
new Function('exports', 'module', output)(item.exports, item);
const { inferLearningTrack } = item.exports;
const cases = [
  ['Build websites for local businesses', 'web-development'],
  ['Become a front-end developer', 'web-development'],
  ['Learn back end development', 'web-development'],
  ['Work as a full-stack engineer', 'web-development'],
  ['Learn Node.js', 'web-development'],
  ['Learn React and TypeScript', 'web-development'],
  ['I want to use Python to build websites', 'web-development'],
  ['Become a UX/UI designer', 'product-design'],
  ['Conduct user research and create prototypes', 'product-design'],
  ['Create user interfaces and wireframes', 'product-design'],
  ['Learn Figma', 'product-design'],
  ['Become a data scientist', 'data-science'],
  ['Analyze customer data for better decisions', 'data-science'],
  ['Study machine learning', 'data-science'],
  ['Learn Python and SQL', 'data-science'],
  ['I know Python, but I want to build websites', 'web-development'],
  ['I do not want data science; I want to learn UX design', 'product-design'],
  ['I want web development rather than data science', 'web-development'],
  ['Transition from data science to product design', 'product-design'],
  ['I work in web development. My goal is to analyze data', 'data-science'],
];
for (const [goal, expected] of cases) {
  assert.equal(inferLearningTrack(goal), expected, goal);
}
for (const goal of ['', 'Advance my career', 'Join a metadata webinar and build confidence', 'Learn web development and product design']) {
  assert.equal(inferLearningTrack(goal, 'product-design'), 'product-design', goal);
}
assert.equal(inferLearningTrack('Advance my career'), 'data-science');
assert.equal(inferLearningTrack('Not web development, but UX', 'web-development'), 'product-design');
assert.equal(inferLearningTrack('I want UX, not web development', 'web-development'), 'product-design');
console.log(`Learning direction checks passed (${cases.length + 7} assertions).`);
