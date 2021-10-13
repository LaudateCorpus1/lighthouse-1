/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const {replaceFsMethods} = require('./inline-fs.js');

/** @typedef {import('rollup').Plugin} RollupPlugin */

/** @type {RollupPlugin} */
const inlineFs = {
  name: 'inline-fs',

  /**
   * @param {string} code
   * @param {string} id
   * @return {Promise<string|null>}
   */
  async transform(code, id) {
    try {
      // TODO(bckenny): add source maps, expand verbose logging support.
      return await replaceFsMethods(code, id);
    } catch (err) {
      // If some construct can't be replaced by inline-fs, just skip this file.
      return null;
    }
  },
};

module.exports = inlineFs;
