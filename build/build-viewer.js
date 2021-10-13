/**
 * @license Copyright 2018 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const fs = require('fs');
const browserify = require('browserify');
const rollupPlugins = require('./rollup-plugins.js');
const GhPagesApp = require('./gh-pages-app.js');
const {LH_ROOT} = require('../root.js');
const inlineFs = require('./plugins/browserify-inline-fs.js');

const localeBasenames = fs.readdirSync(LH_ROOT + '/shared/localization/locales/');
const actualLocales = localeBasenames
  .filter(basename => basename.endsWith('.json') && !basename.endsWith('.ctc.json'))
  .map(locale => locale.replace('.json', ''))
  .sort();

/**
 * Build viewer, optionally deploying to gh-pages if `--deploy` flag was set.
 */
async function run() {
  // JS bundle from browserified ReportGenerator.
  const generatorFilename = `${LH_ROOT}/report/generator/report-generator.js`;
  const generatorBrowserify = browserify(generatorFilename, {standalone: 'ReportGenerator'})
    // Flow report is not used in report viewer, so don't include flow assets.
    .ignore(require.resolve('../report/generator/flow-report-assets.js'))
    .transform(inlineFs);

  /** @type {Promise<string>} */
  const generatorJsPromise = new Promise((resolve, reject) => {
    generatorBrowserify.bundle((err, src) => {
      if (err) return reject(err);
      resolve(src.toString());
    });
  });

  const app = new GhPagesApp({
    name: 'viewer',
    appDir: `${LH_ROOT}/lighthouse-viewer/app`,
    html: {path: 'index.html'},
    stylesheets: [
      {path: 'styles/*'},
    ],
    javascripts: [
      await generatorJsPromise,
      {path: require.resolve('pako/dist/pako_inflate.js')},
      {path: 'src/main.js', rollup: true, rollupPlugins: [
        rollupPlugins.replace({
          // Default delimiters are word boundraries. Setting them to nothing (empty strings)
          // makes this plugin replace any subtring found.
          delimiters: ['', ''],
          values: {
            '[\'__availableLocales__\']': JSON.stringify(actualLocales),
          },
        }),
        rollupPlugins.replace({
          values: {
            '__dirname': '""',
          },
        }),
        rollupPlugins.shim({
          './locales.js': 'export default {}',
        }),
        rollupPlugins.commonjs(),
        rollupPlugins.nodePolyfills(),
        rollupPlugins.nodeResolve({preferBuiltins: true}),
      ]},
    ],
    assets: [
      {path: 'images/**/*', destDir: 'images'},
      {path: 'manifest.json'},
      {path: '../../shared/localization/locales/*.json', destDir: 'locales'},
    ],
  });

  await app.build();

  const argv = process.argv.slice(2);
  if (argv.includes('--deploy')) {
    await app.deploy();
  }
}

run();
