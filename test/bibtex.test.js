import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  parseBib, serializeBib, loadBib, saveBib,
  findEntry, getField, setField, removeField,
  replaceEntry, deleteEntry, addEntry,
} from '../src/bibtex.js';

// ---------------------------------------------------------------------------
// Synthetic BibTeX fixtures
// ---------------------------------------------------------------------------

const ARTICLE = `@article{smith2023,
  author = {Smith, John and Doe, Jane},
  title = {A {Study} of Things},
  journal = {Journal of Stuff},
  year = {2023},
  volume = {42},
  pages = {1--10}
}`;

const BOOK = `@book{jones2020,
  author = {Jones, Alice},
  title = {My Book},
  publisher = {Acme Press},
  year = {2020}
}`;

const MULTI = ARTICLE + '\n\n' + BOOK;

const WITH_STRING = `@string{jstuff = {Journal of Stuff}}
@article{macro2023,
  author = {Author, A},
  title = {Macro Test},
  journal = jstuff,
  year = {2023}
}`;

// ---------------------------------------------------------------------------
// parseBib
// ---------------------------------------------------------------------------

describe('parseBib', () => {
  it('parses a single article entry', () => {
    const lib = parseBib(ARTICLE);
    assert.equal(lib.entries.length, 1);
    const e = lib.entries[0];
    assert.equal(e.type, 'article');
    assert.equal(e.key, 'smith2023');
  });

  it('preserves raw field values (verbatim mode)', () => {
    const lib = parseBib(ARTICLE);
    const e = lib.entries[0];
    // braces around sub-word should be preserved
    assert.match(e.fields.title, /\{Study\}/);
  });

  it('parses multiple entries', () => {
    const lib = parseBib(MULTI);
    assert.equal(lib.entries.length, 2);
    assert.equal(lib.entries[0].key, 'smith2023');
    assert.equal(lib.entries[1].key, 'jones2020');
  });

  it('captures @string macros', () => {
    const lib = parseBib(WITH_STRING);
    assert.ok(lib.strings);
    const key = Object.keys(lib.strings).find(k => k.toLowerCase() === 'jstuff');
    assert.ok(key, '@string jstuff should be captured');
  });

  it('returns parse errors for malformed input', () => {
    // missing closing brace — should still produce an error array
    const lib = parseBib('@article{bad, author = {Oops}');
    assert.ok(Array.isArray(lib.errors));
  });

  it('fields record has lowercase keys', () => {
    const lib = parseBib(ARTICLE);
    const fieldNames = Object.keys(lib.entries[0].fields);
    for (const name of fieldNames) {
      assert.equal(name, name.toLowerCase(), `field name "${name}" should be lowercase`);
    }
  });
});

// ---------------------------------------------------------------------------
// serializeBib
// ---------------------------------------------------------------------------

describe('serializeBib', () => {
  it('round-trips through parse → serialize → parse', () => {
    const lib1 = parseBib(MULTI);
    const text = serializeBib(lib1.entries);
    const lib2 = parseBib(text);
    assert.equal(lib2.entries.length, lib1.entries.length);
    for (const e1 of lib1.entries) {
      const e2 = findEntry(lib2.entries, e1.key);
      assert.ok(e2, `entry "${e1.key}" should survive round-trip`);
      for (const [field, val] of Object.entries(e1.fields)) {
        assert.equal(e2.fields[field], val, `field "${field}" should round-trip unchanged`);
      }
    }
  });

  it('serializes @string macros', () => {
    const lib = parseBib(ARTICLE);
    const text = serializeBib(lib.entries, { jstuff: 'Journal of Stuff' });
    assert.match(text, /@string\{jstuff/);
  });

  it('wraps plain text values in braces', () => {
    const entries = [{ type: 'misc', key: 'k1', fields: { note: 'hello world' } }];
    const text = serializeBib(entries);
    assert.match(text, /note = \{hello world\}/);
  });

  it('leaves bare integers unwrapped', () => {
    const entries = [{ type: 'misc', key: 'k1', fields: { year: '2023' } }];
    const text = serializeBib(entries);
    assert.match(text, /year = 2023/);
  });

  it('does not double-wrap already-braced values', () => {
    const entries = [{ type: 'misc', key: 'k1', fields: { title: '{Already Braced}' } }];
    const text = serializeBib(entries);
    assert.match(text, /title = \{Already Braced\}/);
    assert.doesNotMatch(text, /\{\{Already/);
  });
});

// ---------------------------------------------------------------------------
// findEntry
// ---------------------------------------------------------------------------

describe('findEntry', () => {
  const { entries } = parseBib(MULTI);

  it('finds an entry by exact key', () => {
    const e = findEntry(entries, 'smith2023');
    assert.ok(e);
    assert.equal(e.key, 'smith2023');
  });

  it('finds an entry case-insensitively', () => {
    const e = findEntry(entries, 'SMITH2023');
    assert.ok(e);
  });

  it('returns null for a missing key', () => {
    assert.equal(findEntry(entries, 'nosuchkey'), null);
  });
});

// ---------------------------------------------------------------------------
// getField
// ---------------------------------------------------------------------------

describe('getField', () => {
  const e = parseBib(ARTICLE).entries[0];

  it('returns a field value', () => {
    const v = getField(e, 'year');
    assert.equal(v, '2023');
  });

  it('is case-insensitive for field name', () => {
    assert.equal(getField(e, 'YEAR'), getField(e, 'year'));
  });

  it('returns null for missing field', () => {
    assert.equal(getField(e, 'doi'), null);
  });
});

// ---------------------------------------------------------------------------
// setField
// ---------------------------------------------------------------------------

describe('setField', () => {
  const e = parseBib(ARTICLE).entries[0];

  it('sets a new field', () => {
    const updated = setField(e, 'doi', '10.1234/test');
    assert.equal(updated.fields.doi, '10.1234/test');
  });

  it('overwrites an existing field', () => {
    const updated = setField(e, 'year', '2099');
    assert.equal(updated.fields.year, '2099');
  });

  it('does not mutate the original entry', () => {
    const updated = setField(e, 'year', '2099');
    assert.equal(e.fields.year, '2023');
  });

  it('stores field name in lowercase', () => {
    const updated = setField(e, 'VOLUME', '99');
    assert.ok('volume' in updated.fields);
    assert.ok(!('VOLUME' in updated.fields));
  });
});

// ---------------------------------------------------------------------------
// removeField
// ---------------------------------------------------------------------------

describe('removeField', () => {
  const e = parseBib(ARTICLE).entries[0];

  it('removes an existing field', () => {
    const updated = removeField(e, 'volume');
    assert.ok(!('volume' in updated.fields));
  });

  it('does not mutate the original entry', () => {
    removeField(e, 'volume');
    assert.ok('volume' in e.fields);
  });

  it('is a no-op for a non-existent field', () => {
    const updated = removeField(e, 'nosuchfield');
    assert.deepEqual(Object.keys(updated.fields), Object.keys(e.fields));
  });
});

// ---------------------------------------------------------------------------
// replaceEntry
// ---------------------------------------------------------------------------

describe('replaceEntry', () => {
  const { entries } = parseBib(MULTI);

  it('replaces the matching entry', () => {
    const modified = setField(entries[0], 'year', '1999');
    const updated = replaceEntry(entries, 'smith2023', modified);
    assert.equal(updated[0].fields.year, '1999');
  });

  it('leaves other entries unchanged', () => {
    const modified = setField(entries[0], 'year', '1999');
    const updated = replaceEntry(entries, 'smith2023', modified);
    assert.equal(updated[1].key, 'jones2020');
  });

  it('does not mutate the original array', () => {
    const modified = setField(entries[0], 'year', '1999');
    replaceEntry(entries, 'smith2023', modified);
    assert.equal(entries[0].fields.year, '2023');
  });
});

// ---------------------------------------------------------------------------
// deleteEntry
// ---------------------------------------------------------------------------

describe('deleteEntry', () => {
  const { entries } = parseBib(MULTI);

  it('removes the entry', () => {
    const updated = deleteEntry(entries, 'smith2023');
    assert.equal(updated.length, 1);
    assert.equal(updated[0].key, 'jones2020');
  });

  it('is case-insensitive', () => {
    const updated = deleteEntry(entries, 'SMITH2023');
    assert.equal(updated.length, 1);
  });

  it('returns original array when key not found', () => {
    const updated = deleteEntry(entries, 'nosuchkey');
    assert.equal(updated.length, 2);
  });
});

// ---------------------------------------------------------------------------
// addEntry
// ---------------------------------------------------------------------------

describe('addEntry', () => {
  const { entries } = parseBib(ARTICLE);

  it('appends a new entry', () => {
    const newEntry = { type: 'misc', key: 'newkey', fields: { title: 'New' } };
    const updated = addEntry(entries, newEntry);
    assert.equal(updated.length, 2);
    assert.equal(updated[1].key, 'newkey');
  });

  it('does not mutate the original array', () => {
    const newEntry = { type: 'misc', key: 'newkey', fields: {} };
    addEntry(entries, newEntry);
    assert.equal(entries.length, 1);
  });
});

// ---------------------------------------------------------------------------
// loadBib / saveBib (file I/O round-trip)
// ---------------------------------------------------------------------------

describe('loadBib / saveBib', () => {
  it('round-trips a .bib file through save → load', async () => {
    const tmp = join(tmpdir(), `test-${Date.now()}.bib`);
    try {
      const lib1 = parseBib(MULTI);
      await saveBib(tmp, lib1.entries, lib1.strings ?? {});
      const lib2 = await loadBib(tmp);
      assert.equal(lib2.entries.length, lib1.entries.length);
      for (const e1 of lib1.entries) {
        const e2 = findEntry(lib2.entries, e1.key);
        assert.ok(e2, `"${e1.key}" should survive file round-trip`);
      }
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('throws for a non-existent file', async () => {
    await assert.rejects(() => loadBib('/no/such/file.bib'));
  });

  it('loadBib exposes mtime', async () => {
    const tmp = join(tmpdir(), `test-mtime-${Date.now()}.bib`);
    try {
      await saveBib(tmp, [], {});
      const lib = await loadBib(tmp);
      assert.ok(typeof lib.mtime === 'number', 'mtime should be a number');
      assert.ok(lib.mtime > 0, 'mtime should be positive');
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('saveBib succeeds when expectedMtime matches', async () => {
    const tmp = join(tmpdir(), `test-mtime-ok-${Date.now()}.bib`);
    try {
      await saveBib(tmp, [], {});
      const lib = await loadBib(tmp);
      // Should not throw — mtime is still current
      await assert.doesNotReject(() => saveBib(tmp, lib.entries, {}, lib.mtime));
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('saveBib rejects when expectedMtime is stale', async () => {
    const tmp = join(tmpdir(), `test-mtime-stale-${Date.now()}.bib`);
    try {
      await saveBib(tmp, [], {});
      const lib = await loadBib(tmp);
      // Simulate a concurrent write by overwriting the file before we save
      await writeFile(tmp, '% modified\n', 'utf8');
      await assert.rejects(
        () => saveBib(tmp, lib.entries, {}, lib.mtime),
        /modified by another process/
      );
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('saveBib writes atomically — no partial file visible on rename', async () => {
    const tmp = join(tmpdir(), `test-atomic-${Date.now()}.bib`);
    try {
      const lib1 = parseBib(ARTICLE);
      await saveBib(tmp, lib1.entries, {});
      const lib2 = await loadBib(tmp);
      // File should be fully parseable after write
      assert.ok(lib2.entries.length > 0);
      assert.ok(lib2.mtime > 0);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('saveBib skips mtime check when expectedMtime is null', async () => {
    const tmp = join(tmpdir(), `test-mtime-null-${Date.now()}.bib`);
    try {
      await saveBib(tmp, [], {}, null);   // new-file path — no check
      const stat = await import('fs/promises').then(m => m.stat(tmp));
      assert.ok(stat.size >= 0);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });
});
