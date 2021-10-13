/**
 * @license Copyright 2019 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const browserify = require('browserify');
const rollup = require('rollup');
const rollupPlugins = require('./rollup-plugins.js');
const fs = require('fs');
const path = require('path');
const bundleBuilder = require('./build-bundle.js');
const {buildPsiReport} = require('./build-report.js');
const {LH_ROOT} = require('../root.js');
const inlineFs = require('./plugins/browserify-inline-fs.js');

const distDir = path.join(LH_ROOT, 'dist', 'lightrider');
const sourceDir = path.join(LH_ROOT, 'clients', 'lightrider');

const bundleOutFile = `${distDir}/report-generator-bundle.js`;
const generatorFilename = `./report/generator/report-generator.js`;

const entrySourceName = 'lightrider-entry.js';
const entryDistName = 'lighthouse-lr-bundle.js';

fs.mkdirSync(path.dirname(distDir), {recursive: true});

/**
 * Browserify and minify entry point.
 */
function buildEntryPoint() {
  const inFile = `${sourceDir}/${entrySourceName}`;
  const outFile = `${distDir}/${entryDistName}`;
  return bundleBuilder.build(inFile, outFile);
}

/**
 * Browserify and minify the LR report generator.
 */
function buildReportGenerator() {
  browserify(generatorFilename, {standalone: 'ReportGenerator'})
    // Flow report is not used in LR, so don't include flow assets.
    .ignore(require.resolve('../report/generator/flow-report-assets.js'))
    // Transform the fs.readFile etc into inline strings.
    .transform(inlineFs)
    .bundle((err, src) => {
      if (err) throw err;
      fs.writeFileSync(bundleOutFile, src.toString());
    });
}

async function buildStaticServerBundle() {
  const bundle = await rollup.rollup({
    input: 'lighthouse-cli/test/fixtures/static-server.js',
    plugins: [
      rollupPlugins.shim({
        'es-main': 'export default function() { return false; }',
      }),
      rollupPlugins.commonjs(),
      rollupPlugins.nodeResolve(),
    ],
    external: ['mime-types', 'glob'],
  });

  await bundle.write({
    file: 'dist/lightrider/static-server.js',
    format: 'commonjs',
  });
}

async function run() {
  await Promise.all([
    buildEntryPoint(),
    buildReportGenerator(),
    buildPsiReport(),
    buildStaticServerBundle(),
  ]);
}

run();
