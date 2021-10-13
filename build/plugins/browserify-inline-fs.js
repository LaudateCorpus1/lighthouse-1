/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const {Transform} = require('stream');

const {replaceFsMethods} = require('./inline-fs.js');

const {performance} = require('perf_hooks');

/** @type {Array<{filepath: string, elapsed: number}>} */
const performanceEntries = [];

/**
 * @param {string} filepath
 * @return {Transform}
 */
module.exports = (filepath) => {
  /** @type {Array<Buffer>} */
  const chunks = [];

  let startTime = -1;

  return new Transform({
    transform(chunk, encoding, callback) {
      if (startTime === -1) {
        startTime = performance.now();
      }

      chunks.push(Buffer.from(chunk));
      callback();
    },
    flush(callback) {
      const code = Buffer.concat(chunks).toString('utf8');
      replaceFsMethods(code, filepath).then(replaced => {
        // Fall back to original if replaceFsMethods did nothing and returned `null`.
        replaced = replaced || code;
        callback(null, replaced);
      }).catch(() => {
        // If some construct can't be replaced by inline-fs, just skip this file.
        callback(null, code);
      }).finally(() => {
        const endTime = performance.now();
        const elapsed = endTime - startTime;
        performanceEntries.push({filepath, elapsed});
      });
    },
  });
};

module.exports.performanceEntries = performanceEntries;
