/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

/**
 * @fileoverview Types to provide basic `acorn` coverage, mainly to open up full
 * ESTree AST types for the subset of acorn functionality we need.
 * See https://github.com/acornjs/acorn/issues/946
 */

declare module 'acorn' {
  interface Options {
    /** Indicates the ECMAScript version to parse, by version, year, or `'latest'` (the latest acorn supports). */
    ecmaVersion: 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 'latest';
    /** Indicate the mode the code should be parsed in. Can be either `'script'` or `'module'`. This influences global strict mode and parsing of `import` and `export` declarations. */
    sourceType?: 'script' | 'module';
    /** By default, `import` and `export` declarations can only appear at a program's top level. Setting this option to `true` allows them anywhere where a statement is allowed, and also allows `import.meta` expressions to appear in scripts (when `sourceType` is not `'module'`). */
    allowImportExportEverywhere?: boolean;
    /** If `false`, `await` expressions can only appear inside `async` functions. Defaults to `true` for ecmaVersion 2022 and later, `false` for lower versions. Setting this option to `true` allows to have top-level `await` expressions. They are still not allowed in non-`async` functions, though. */
    allowAwaitOutsideFunction?: boolean;
  }

  class Parser {
    constructor(options: Options, input: string, startPos?: number)

    /**  Read a single token, updating the parser object's token-related properties. */
    nextToken(): void;

    /** Parse an assignment expression. */
    parseMaybeAssign(): import('estree').Node;
  }
}
