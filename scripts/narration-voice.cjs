/* eslint-disable @typescript-eslint/no-require-imports */
/** Voice preference checks use descriptors, without relying on installed system voices. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/narration-voice.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const item = { exports: {} };
new Function('exports', 'module', output)(item.exports, item);
const { chooseNarrationVoice } = item.exports;
const voice = (name, voiceURI = name, lang = 'en-US', isDefault = false) => ({
  name, voiceURI, lang, default: isDefault, localService: true,
});
const amanda = voice('Microsoft AmandaMultilingual Online (Natural)');
const aria = voice('Microsoft Aria Online (Natural)');
const samantha = voice('Samantha', 'com.apple.voice.compact.en-US.Samantha');
const enhancedSamantha = voice('Samantha', 'com.apple.voice.enhanced.en-US.Samantha');
const fred = voice('Fred', 'Fred', 'en-US', true);
const french = voice('French Natural', 'fr-natural', 'fr-FR');
let assertions = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions++; };

equal(chooseNarrationVoice([samantha, aria, amanda]), amanda, 'Amanda Multilingual is preferred when available');
equal(chooseNarrationVoice([aria, amanda], aria.voiceURI), aria, 'An available saved preference wins');
equal(chooseNarrationVoice([samantha, aria], 'not-installed'), aria, 'A missing preference uses the best available voice');
equal(chooseNarrationVoice([fred, samantha]), samantha, 'A clear narrator wins over the default character voice');
equal(chooseNarrationVoice([samantha, enhancedSamantha]), enhancedSamantha, 'Enhanced Samantha wins over the compact version');
equal(chooseNarrationVoice([enhancedSamantha, aria]), aria, 'Neural narration wins over a basic system voice');
equal(chooseNarrationVoice([french, samantha]), samantha, 'English narration avoids a different-language voice');
equal(chooseNarrationVoice([french, samantha], french.voiceURI), samantha, 'A different-language saved preference safely falls back');
equal(chooseNarrationVoice([french]), undefined, 'No English voice preserves the browser fallback');
equal(chooseNarrationVoice([]), undefined, 'An initially empty asynchronous voice list is safe');
equal(chooseNarrationVoice([amanda]), amanda, 'A later-loaded voice list selects Amanda');
const british = voice('Unknown', 'en-GB-unknown', 'en-GB');
const american = voice('Unknown', 'en-US-unknown');
equal(chooseNarrationVoice([british, american]), american, 'Equivalent voices prefer US English');
equal(chooseNarrationVoice([british]), british, 'Other English locales remain available');
const original = [fred, aria, samantha];
chooseNarrationVoice(original);
assert.deepEqual(original, [fred, aria, samantha]); assertions++;
console.log(`Narration voice checks passed (${assertions} assertions).`);
