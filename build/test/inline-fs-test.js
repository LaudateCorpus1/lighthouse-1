/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const fs = require('fs');
const path = require('path');
const {replaceFsMethods} = require('../plugins/inline-fs.js');

const {LH_ROOT} = require('../../root.js');
const contextPath = `${LH_ROOT}/lighthouse-core/index.js`;

describe('inline-fs', () => {
  const tmpPath = `${LH_ROOT}/.tmp/inline-fs/test.js`;

  beforeAll(() => {
    fs.mkdirSync(path.dirname(tmpPath), {recursive: true});
  });

  afterAll(() => {
    fs.unlinkSync(tmpPath);
  });

  describe('supported syntax', () => {
    it('returns null for content with no fs calls', async () => {
      const content = 'const val = 1;';
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(null);
    });

    it('throws on contained unrecognized identifiers', async () => {
      const content = `const myContent = fs.readFileSync(filePathVar, 'utf8');`;
      await expect(() => replaceFsMethods(content, contextPath))
        .rejects.toThrow(`unsupported identifier 'filePathVar'`);
    });

    it('throws on contained unsupported expressions', async () => {
      const content = `const myContent = fs.readFileSync(function() {return 'path/'}, 'utf8');`;
      await expect(() => replaceFsMethods(content, contextPath))
        .rejects.toThrow(`unsupported node: FunctionExpression`);
    });

    it('runs `require.resolve`', async () => {
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);

      const axeMin = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
      expect(axeMin.length).toBeGreaterThan(500);
      expect(result).toBe(`const myTextContent = ${JSON.stringify(axeMin)};`);
    });

    it('substitutes `__dirname`', async () => {
      fs.writeFileSync(tmpPath, '__dirname text content');

      const dirnamePath = `__dirname + '/../.tmp/inline-fs/test.js'`;
      const content = `const myTextContent = fs.readFileSync(${dirnamePath}, 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`const myTextContent = "__dirname text content";`);
    });

    it('concats strings', async () => {
      fs.writeFileSync(tmpPath, 'concat text content');

      const concatPath = `__dirname + '/../' + '.tmp/inline-fs/test.js'`;
      const content = `const myTextContent = fs.readFileSync(${concatPath}, 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`const myTextContent = "concat text content";`);
    });

    it('evaluates template literals', async () => {
      fs.writeFileSync(tmpPath, 'template literal text content');

      const templatePath = '`${__dirname}/../.tmp/${"inline-fs"}/test.js`';
      const content = `const myTextContent = fs.readFileSync(${templatePath}, 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`const myTextContent = "template literal text content";`);
    });

    it('evaluates expressions in template literals', async () => {
      fs.writeFileSync(tmpPath, 'more template literal text content');

      const templatePath = `\`\${__dirname}/\${path.relative(__dirname, '${tmpPath}')}\``;
      const content = `const myTextContent = fs.readFileSync(${templatePath}, 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`const myTextContent = "more template literal text content";`);
    });

    it('evaluates expressions in `require.resolve` calls', async () => {
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(require.resolve('axe-core' + \`/axe.${'min'}.js\`), 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);

      const axeMin = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
      expect(axeMin.length).toBeGreaterThan(500);
      expect(result).toBe(`const myTextContent = ${JSON.stringify(axeMin)};`);
    });

    it('throws on unsupported path methods', async () => {
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(path.isAbsolute('${tmpPath}'), 'utf8');`;
      await expect(() => replaceFsMethods(content, contextPath))
        .rejects.toThrow(`'path.isAbsolute' is not supported with 'fs' function calls`);
    });

    // TODO(bckenny): zero length path.resolve() (resolves to cwd?)
    // syntax errors, warnings but resume on unsupported syntax
  });

  describe('fs.readFileSync', () => {
    it('inlines content from fs.readFileSync calls', async () => {
      fs.writeFileSync(tmpPath, 'some text content');
      const content = `const myTextContent = fs.readFileSync('${tmpPath}', 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`const myTextContent = "some text content";`);
    });

    it('inlines content with quotes', async () => {
      fs.writeFileSync(tmpPath, `"quoted", and an unbalanced quote: "`);
      const content = `const myTextContent = fs.readFileSync('${tmpPath}', 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`const myTextContent = "\\"quoted\\", and an unbalanced quote: \\"";`);
    });

    it('inlines multiple fs.readFileSync calls', async () => {
      fs.writeFileSync(tmpPath, 'some text content');
      // eslint-disable-next-line max-len
      const content = `fs.readFileSync('${tmpPath}', 'utf8')fs.readFileSync(require.resolve('${tmpPath}'), 'utf8')`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`"some text content""some text content"`);
    });

    it('throws on nested fs.readFileSync calls', async () => {
      fs.writeFileSync(tmpPath, `${LH_ROOT}/lighthouse-cli/index.js`);
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(fs.readFileSync('${tmpPath}', 'utf8'), 'utf8');`;
      await expect(() => replaceFsMethods(content, contextPath))
        .rejects.toThrow('Only `require.resolve()` and `path` methods are supported');
    });

    it('executes path methods to determine the file to read', async () => {
      const fileContents = 'some tricky-to-get text content';
      fs.writeFileSync(tmpPath, fileContents);

      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(path.join(path.dirname('${tmpPath}'), path.basename('${tmpPath}')), 'utf8');`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result).toBe(`const myTextContent = "${fileContents}";`);
    });

    it('inlines content from fs.readFileSync with variants of utf8 options', async () => {
      fs.writeFileSync(tmpPath, 'some text content');

      const utf8Variants = [
        `'utf8'`,
        `'utf-8'`,
        `{encoding: 'utf8'}`,
        `{encoding: 'utf-8'}`,
        `{encoding: 'utf8', nonsense: 'flag'}`,
      ];

      for (const opts of utf8Variants) {
        const content = `const myTextContent = fs.readFileSync('${tmpPath}', ${opts});`;
        const result = await replaceFsMethods(content, contextPath);
        expect(result).toBe(`const myTextContent = "some text content";`);
      }
    });
  });

  describe('fs.readdirSync', () => {
    it('inlines content from fs.readdirSync calls', async () => {
      fs.writeFileSync(tmpPath, 'text');
      const tmpDir = path.dirname(tmpPath);
      const content = `const files = fs.readdirSync('${tmpDir}');`;
      const result = await replaceFsMethods(content, contextPath);
      const tmpFilename = path.basename(tmpPath);
      expect(result).toBe(`const files = ["${tmpFilename}"];`);
    });

    it('handles methods chained on fs.readdirSync result', async () => {
      fs.writeFileSync(tmpPath, 'text');
      const tmpDir = path.dirname(tmpPath);
      // eslint-disable-next-line max-len
      const content = `const files = [...fs.readdirSync('${tmpDir}'), ...fs.readdirSync('${tmpDir}').map(f => \`metrics/\${f}\`)]`;
      const result = await replaceFsMethods(content, contextPath);
      expect(result)
        .toBe('const files = [...["test.js"], ...["test.js"].map(f => `metrics/${f}`)]');
    });

    it('inlines content from fs.readdirSync with variants of utf8 options', async () => {
      fs.writeFileSync(tmpPath, 'text');
      const tmpDir = path.dirname(tmpPath);
      const tmpFilename = path.basename(tmpPath);

      const utf8Variants = [
        '', // `options` are optional for readdirSync, so include missing opts.
        `'utf8'`,
        `'utf-8'`,
        `{encoding: 'utf8'}`,
        `{encoding: 'utf-8'}`,
        `{encoding: 'utf8', nonsense: 'flag'}`,
      ];

      for (const opts of utf8Variants) {
        // Trailing comma has no effect in missing opts case.
        const content = `const files = fs.readdirSync('${tmpDir}', ${opts});`;
        const result = await replaceFsMethods(content, contextPath);
        expect(result).toBe(`const files = ["${tmpFilename}"];`);
      }
    });

    it('throws when trying to fs.readdirSync a non-existent directory', async () => {
      const nonsenseDir = `${LH_ROOT}/.tmp/nonsense-path/`;
      const content = `const files = fs.readdirSync('${nonsenseDir}');`;
      await expect(() => replaceFsMethods(content, contextPath))
        .rejects.toThrow(/^could not inline fs\.readdirSync.+ENOENT.+nonsense-path\/'$/);
    });
  });
});
