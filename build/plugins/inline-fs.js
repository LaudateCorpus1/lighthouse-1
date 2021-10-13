/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const resolve = require('resolve');
const MagicString = require('magic-string').default;
const terser = require('terser');

const {LH_ROOT} = require('../../root.js');

// ESTree provides much better types for AST nodes. See https://github.com/acornjs/acorn/issues/946
/** @typedef {import('estree').Node} Node */
/** @typedef {import('estree').SimpleCallExpression} SimpleCallExpression */

/**
 * Uses assert.strictEqual, but does not widen the type to generic `string`,
 * preserving string literals (if applicable).
 * @template {string} T
 * @param {string} actual
 * @param {T} expected
 * @param {string=} errorMessage
 * @return {asserts actual is T}
 */
function assertEqualString(actual, expected, errorMessage) {
  assert.equal(actual, expected, errorMessage);
}

/**
 * A version of acorn's parseExpressionAt that stops at commas, allowing parsing
 * non-sequence expressions, like inside arrays.
 * @param {string} input
 * @param {number} offset
 * @param {import('acorn').Options} options
 * @return {Node}
 */
function parseExpressionAt(input, offset, options) {
  const parser = new acorn.Parser(options, input, offset);
  parser.nextToken();
  return parser.parseMaybeAssign();
}

/**
 * Collapse tree at `node` using supported transforms until only a string
 * literal is returned (or an error is thrown for unsupported nodes).
 * @param {Node} node ESTree node.
 * @param {string} contextPath The path of the file containing this node.
 * @return {string}
 */
function collapseToStringLiteral(node, contextPath) {
  switch (node.type) {
    case 'Literal': {
      // If your literal wasn't a string, sorry, you're getting a string.
      return String(node.value);
    }

    case 'Identifier': {
      if (node.name === '__dirname') {
        return path.dirname(contextPath);
      } else if (node.name === '__filename') {
        return contextPath;
      }
      throw new Error(`unsupported identifier '${node.name}'`);
    }

    case 'CallExpression': {
      return collapseCallExpression(node, contextPath);
    }

    case 'BinaryExpression': {
      assert.equal(node.operator, '+', 'only string `+` operators supported');
      const left = collapseToStringLiteral(node.left, contextPath);
      const right = collapseToStringLiteral(node.right, contextPath);
      return left + right;
    }

    case 'TemplateLiteral': {
      assert.equal(node.expressions.length + 1, node.quasis.length);
      // Parts alternate between quasis and expressions, starting and ending with a quasi.
      const parts = [];
      for (let i = 0; i < node.expressions.length; i++) {
        parts.push(collapseToStringLiteral(node.quasis[i], contextPath));
        parts.push(collapseToStringLiteral(node.expressions[i], contextPath));
      }
      parts.push(collapseToStringLiteral(node.quasis[node.quasis.length - 1], contextPath));
      return parts.join('');
    }

    case 'TemplateElement': {
      // Keep tsc happy. AST generation should error if invalid escape sequence in template literal.
      if (typeof node.value.cooked !== 'string') throw new Error('syntax error');
      return node.value.cooked;
    }
  }

  throw new Error(`unsupported node: ${node.type}`);
}

/**
 * Evaluate supported function calls and return the string result. Limited to
 * `require.resolve` and a subset of `path` methods.
 * @param {SimpleCallExpression} node ESTree CallExpression node.
 * @param {string} contextPath The path of the file containing this node.
 * @return {string}
 */
function collapseCallExpression(node, contextPath) {
  // eslint-disable-next-line max-len
  const unsupportedMsg = 'Only `require.resolve()` and `path` methods are supported within `fs` function calls';

  assertEqualString(node.callee.type, 'MemberExpression', unsupportedMsg);
  assertEqualString(node.callee.object.type, 'Identifier', unsupportedMsg);
  assertEqualString(node.callee.property.type, 'Identifier');

  if (node.callee.object.name === 'require') {
    assert.equal(node.callee.property.name, 'resolve', unsupportedMsg);
    assert.equal(node.arguments.length, 1, 'only single-argument `require.resolve` is supported');
    const argument = collapseToStringLiteral(node.arguments[0], contextPath);
    return resolve.sync(argument, {basedir: path.dirname(contextPath)});
  }

  if (node.callee.object.name !== 'path') throw new Error(unsupportedMsg);

  const methodName = node.callee.property.name;
  const args = node.arguments.map(arg => collapseToStringLiteral(arg, contextPath));

  // Support path methods that take string argument(s) and return a string.
  const supportedPathMethods = [
    'resolve',
    'normalize',
    'join',
    'relative',
    'dirname',
    'basename',
    'extname',
  ];
  if (!supportedPathMethods.includes(methodName)) {
    throw new Error(`'path.${methodName}' is not supported with 'fs' function calls`);
  }
  // @ts-expect-error: `methodName` established as existing on `path`.
  return path[methodName](...args);
}

/**
 * Returns whether the options object/string specifies the allowed utf8/utf-8
 * encoding.
 * @param {Node} node ESTree node.
 * @return {boolean}
 */
function isUtf8Options(node) {
  // Node allows 'utf-8' as an alias for 'utf8'.
  if (node.type === 'Literal') {
    return node.value === 'utf8' || node.value === 'utf-8';
  } else if (node.type === 'ObjectExpression') {
    // Matches type `{encoding: 'utf8'|'utf-8'}`.
    return node.properties.some(prop => {
      return prop.type === 'Property' &&
          prop.key.type === 'Identifier' && prop.key.name === 'encoding' &&
          prop.value.type === 'Literal' &&
          (prop.value.value === 'utf8' || prop.value.value === 'utf-8');
    });
  }
  return false;
}

/**
 * Attempts to statically determine the target of a `fs.readFileSync()` call and
 * returns the already-quoted contents of the file to be loaded.
 * If it's a JS file, it's minified before inlining.
 * @param {SimpleCallExpression} node ESTree node for `fs.readFileSync` call.
 * @param {string} contextPath
 * @return {Promise<string>}
 */
async function getReadFileReplacement(node, contextPath) {
  assertEqualString(node.callee.type, 'MemberExpression');
  assertEqualString(node.callee.property.type, 'Identifier');
  assert.equal(node.callee.property.name, 'readFileSync');

  assert.equal(node.arguments.length, 2, 'fs.readFileSync() must have two arguments');
  const constructedPath = collapseToStringLiteral(node.arguments[0], contextPath);
  assert.equal(isUtf8Options(node.arguments[1]), true, 'only utf8 readFileSync is supported');

  let readContent = await fs.promises.readFile(constructedPath, 'utf8');

  // Minify inlined javascript.
  if (constructedPath.endsWith('.js')) {
    const result = await terser.minify({[constructedPath]: readContent}, {ecma: 2019});
    if (result.code) {
      readContent = result.code;
    }
  }

  // Escape quotes, new lines, etc so inlined string doesn't break host file.
  return JSON.stringify(readContent);
}

/**
 * Attempts to statically determine the target of a `fs.readdirSync()` call and
 * returns a JSON.stringified array with the contents of the target directory.
 * @param {SimpleCallExpression} node ESTree node for `fs.readdirSync` call.
 * @param {string} contextPath
 * @return {Promise<string>}
 */
async function getReaddirReplacement(node, contextPath) {
  assertEqualString(node.callee.type, 'MemberExpression');
  assertEqualString(node.callee.property.type, 'Identifier');
  assert.equal(node.callee.property.name, 'readdirSync');

  // If there's no second argument, fs.readdirSync defaults to 'utf8'.
  if (node.arguments.length === 2) {
    assert.equal(isUtf8Options(node.arguments[1]), true, 'only utf8 readdirSync is supported');
  }

  const constructedPath = collapseToStringLiteral(node.arguments[0], contextPath);

  try {
    const contents = await fs.promises.readdir(constructedPath, 'utf8');
    return JSON.stringify(contents);
  } catch (err) {
    throw new Error(`could not inline fs.readdirSync call: ${err.message}`);
  }
}

// TODO(bckenny): rename method inlineFs?
/**
 * Inlines the values of selected `fs` methods if their targets can be
 * statically determined. Currently `readFileSync` and `readdirSync` are
 * supported.
 * Returns `null` if no changes were made.
 * @param {string} code
 * @param {string} contextPath
 * @return {Promise<string|null>}
 */
async function replaceFsMethods(code, contextPath) {
  const fsSearch = /fs\.(?:readFileSync|readdirSync)/g;
  const foundIndices = [...code.matchAll(fsSearch)].map(e => e.index);

  // Return null for not-applicable files with as little work as possible.
  if (foundIndices.length === 0) return null;

  const output = new MagicString(code);

  // Can iterate forwards in string because MagicString always uses original indices.
  for (const foundIndex of foundIndices) {
    if (foundIndex === undefined) continue; // https://github.com/microsoft/TypeScript/issues/36788

    let parsed;
    try {
      parsed = parseExpressionAt(code, foundIndex, {ecmaVersion: 'latest'});
    } catch (err) {
      // TODO(bckenny): can use err.pos. Move this into parseExpressionAt.
      // eslint-disable-next-line max-len
      throw new Error(`${err.message} - ${path.relative(LH_ROOT, contextPath)}:${foundIndex} '${code.substr(foundIndex, 50)}'`);
    }

    // If root of expression isn't the fs call, descend down chained methods on
    // the result (e.g. `fs.readdirSync().map(...)`) until reaching the fs call.
    for (;;) {
      assertEqualString(parsed.type, 'CallExpression');
      assertEqualString(parsed.callee.type, 'MemberExpression');
      if (parsed.callee.object.type === 'Identifier' && parsed.callee.object.name === 'fs') {
        break;
      }

      parsed = parsed.callee.object;
    }

    // We've regexed for an fs method, so the property better be an identifier.
    assertEqualString(parsed.callee.property.type, 'Identifier');

    let content;
    if (parsed.callee.property.name === 'readFileSync') {
      content = await getReadFileReplacement(parsed, contextPath);
    } else if (parsed.callee.property.name === 'readdirSync') {
      content = await getReaddirReplacement(parsed, contextPath);
    } else {
      throw new Error(`unexpected fs call 'fs.${parsed.callee.property.name}'`);
    }

    // @ts-expect-error - `start` and `end` provided by acorn over ESTree types.
    const {start, end} = parsed;
    // TODO(bckenny): use options to customize `storeName` for source maps.
    output.overwrite(start, end, content);
  }

  return output.toString();
}

module.exports = {
  replaceFsMethods,
};
