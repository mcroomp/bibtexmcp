/**
 * Integration tests for the BibTeX MCP server.
 *
 * Uses the MCP SDK Client over stdio to communicate with the server subprocess,
 * which is the canonical way to test an MCP server.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '../src/index.js');

// ---------------------------------------------------------------------------
// Fixture .bib file
// ---------------------------------------------------------------------------

const FIXTURE_BIB = `@article{smith2023,
  author = {Smith, John},
  title = {A {Study} of Things},
  journal = {Journal of Stuff},
  year = {2023},
  volume = {42},
  pages = {1--10}
}

@book{jones2020,
  author = {Jones, Alice},
  title = {My Book},
  publisher = {Acme Press},
  year = {2020}
}

@inproceedings{conf2022bad,
  title = {Missing Author Paper},
  booktitle = {ICML},
  year = {2022}
}
`;

let client;
let bibPath;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  bibPath = join(tmpdir(), `mcp-test-${Date.now()}.bib`);
  await writeFile(bibPath, FIXTURE_BIB, 'utf8');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
  });
  client = new Client({ name: 'test-client', version: '1.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close().catch(() => {});
  await unlink(bibPath).catch(() => {});
});

// Helper: call a tool and parse the JSON result text
async function callTool(name, args) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

describe('tools/list', () => {
  it('lists all expected tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map(t => t.name);
    const expected = [
      'query_entries', 'get_entry', 'get_field',
      'create_entry', 'update_field', 'update_fields', 'delete_field', 'delete_entry',
      'replace_entry',
      'validate_entry', 'validate_file',
      'validate_doi', 'validate_doi_batch',
      'lookup_doi_by_metadata', 'fix_from_doi',
      'validate_patent',
      'convert_entry_type', 'list_entry_types',
      'fill_missing_dois',
      'rename_key',
      'create_bib',
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `Tool "${name}" should be listed`);
    }
  });

  it('each tool has a description and inputSchema', async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      assert.ok(tool.description, `"${tool.name}" should have a description`);
      assert.ok(tool.inputSchema, `"${tool.name}" should have an inputSchema`);
    }
  });
});

// ---------------------------------------------------------------------------
// create_bib
// ---------------------------------------------------------------------------

describe('create_bib', () => {
  it('creates a new empty .bib file', async () => {
    const newBib = join(tmpdir(), `create-bib-test-${Date.now()}.bib`);
    try {
      const data = await callTool('create_bib', { file: newBib });
      assert.equal(data.created, true);
      assert.equal(data.file, newBib);
      const content = await readFile(newBib, 'utf8');
      assert.ok(typeof content === 'string', 'file should exist and be readable');
    } finally {
      await unlink(newBib).catch(() => {});
    }
  });

  it('returns an error if the file already exists', async () => {
    const data = await callTool('create_bib', { file: bibPath });
    assert.ok(data.error);
  });

  it('overwrites an existing file when overwrite: true', async () => {
    const newBib = join(tmpdir(), `create-bib-overwrite-${Date.now()}.bib`);
    try {
      await callTool('create_bib', { file: newBib });
      await callTool('create_entry', { file: newBib, key: 'temp2024', type: 'misc', fields: {} });

      const data = await callTool('create_bib', { file: newBib, overwrite: true });
      assert.equal(data.created, true);

      // File should now be empty — the entry added above is gone
      const result = await callTool('query_entries', { file: newBib });
      assert.equal(result.total, 0);
    } finally {
      await unlink(newBib).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// query_entries
// ---------------------------------------------------------------------------

describe('query_entries', () => {
  it('returns all entries when no filters given', async () => {
    const data = await callTool('query_entries', { file: bibPath });
    assert.equal(data.count, 3);
  });

  it('filters by entry type', async () => {
    const data = await callTool('query_entries', { file: bibPath, type: 'article' });
    assert.equal(data.count, 1);
    assert.equal(data.entries[0].key, 'smith2023');
  });

  it('filters by key substring (case-insensitive)', async () => {
    const data = await callTool('query_entries', { file: bibPath, key: 'JONES' });
    assert.equal(data.count, 1);
    assert.equal(data.entries[0].key, 'jones2020');
  });

  it('filters by field value substring', async () => {
    const data = await callTool('query_entries', { file: bibPath, field: 'year', fieldValue: '2023' });
    assert.equal(data.count, 1);
    assert.equal(data.entries[0].key, 'smith2023');
  });

  it('returns empty when no entries match', async () => {
    const data = await callTool('query_entries', { file: bibPath, key: 'nosuchkey' });
    assert.equal(data.count, 0);
    assert.deepEqual(data.entries, []);
  });

  it('returns entries with their fields', async () => {
    const data = await callTool('query_entries', { file: bibPath, key: 'smith2023' });
    assert.equal(data.entries[0].fields.year, '2023');
  });
});

// ---------------------------------------------------------------------------
// get_entry
// ---------------------------------------------------------------------------

describe('get_entry', () => {
  it('returns the requested entry', async () => {
    const data = await callTool('get_entry', { file: bibPath, key: 'smith2023' });
    assert.equal(data.entry.key, 'smith2023');
    assert.equal(data.entry.type, 'article');
  });

  it('returns fields in the entry', async () => {
    const data = await callTool('get_entry', { file: bibPath, key: 'jones2020' });
    assert.ok('author' in data.entry.fields);
    assert.ok('title' in data.entry.fields);
  });

  it('returns an error for a missing key', async () => {
    const data = await callTool('get_entry', { file: bibPath, key: 'nosuchkey' });
    assert.ok(data.error, 'should return an error object');
    assert.match(data.error, /not found/i);
  });
});

// ---------------------------------------------------------------------------
// get_field
// ---------------------------------------------------------------------------

describe('get_field', () => {
  it('returns the field value', async () => {
    const data = await callTool('get_field', { file: bibPath, key: 'smith2023', field: 'year' });
    assert.equal(data.value, '2023');
  });

  it('is case-insensitive for field name', async () => {
    const lower = await callTool('get_field', { file: bibPath, key: 'smith2023', field: 'author' });
    const upper = await callTool('get_field', { file: bibPath, key: 'smith2023', field: 'AUTHOR' });
    assert.equal(lower.value, upper.value);
  });

  it('returns an error for a missing field', async () => {
    const data = await callTool('get_field', { file: bibPath, key: 'smith2023', field: 'doi' });
    assert.ok(data.error);
  });

  it('returns an error for a missing entry', async () => {
    const data = await callTool('get_field', { file: bibPath, key: 'nokey', field: 'year' });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// create_entry
// ---------------------------------------------------------------------------

describe('create_entry', () => {
  it('creates a new entry and makes it queryable', async () => {
    const created = await callTool('create_entry', {
      file: bibPath,
      key: 'new2024',
      type: 'misc',
      fields: { title: 'New Entry', year: '2024' },
    });
    assert.equal(created.created.key, 'new2024');

    const fetched = await callTool('get_entry', { file: bibPath, key: 'new2024' });
    assert.equal(fetched.entry.fields.title, 'New Entry');
  });

  it('persists across separate tool calls (file I/O)', async () => {
    const raw = await readFile(bibPath, 'utf8');
    assert.match(raw, /new2024/);
  });

  it('normalises field names to lowercase', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'casetest', type: 'misc',
      fields: { TITLE: 'Upper Case Field' },
    });
    const data = await callTool('get_field', { file: bibPath, key: 'casetest', field: 'title' });
    assert.equal(data.value, 'Upper Case Field');
  });

  it('returns an error when the key already exists', async () => {
    const data = await callTool('create_entry', {
      file: bibPath, key: 'smith2023', type: 'misc', fields: {},
    });
    assert.ok(data.error);
    assert.match(data.error, /already exists/i);
  });
});

// ---------------------------------------------------------------------------
// update_field
// ---------------------------------------------------------------------------

describe('update_field', () => {
  it('updates an existing field', async () => {
    await callTool('update_field', { file: bibPath, key: 'jones2020', field: 'year', value: '2021' });
    const data = await callTool('get_field', { file: bibPath, key: 'jones2020', field: 'year' });
    assert.equal(data.value, '2021');
  });

  it('adds a new field not previously present', async () => {
    await callTool('update_field', { file: bibPath, key: 'jones2020', field: 'doi', value: '10.1234/test' });
    const data = await callTool('get_field', { file: bibPath, key: 'jones2020', field: 'doi' });
    assert.equal(data.value, '10.1234/test');
  });

  it('returns an error for a missing entry key', async () => {
    const data = await callTool('update_field', {
      file: bibPath, key: 'nosuchkey', field: 'year', value: '2000',
    });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// delete_field
// ---------------------------------------------------------------------------

describe('delete_field', () => {
  it('removes a field from an entry', async () => {
    // Ensure the field exists first
    await callTool('update_field', { file: bibPath, key: 'smith2023', field: 'volume', value: '42' });

    const del = await callTool('delete_field', { file: bibPath, key: 'smith2023', field: 'volume' });
    assert.equal(del.deletedField, 'volume');

    const get = await callTool('get_field', { file: bibPath, key: 'smith2023', field: 'volume' });
    assert.ok(get.error, 'field should be gone after deletion');
  });

  it('returns an error when the field does not exist', async () => {
    const data = await callTool('delete_field', {
      file: bibPath, key: 'smith2023', field: 'nosuchfield',
    });
    assert.ok(data.error);
  });

  it('returns an error for a missing entry', async () => {
    const data = await callTool('delete_field', { file: bibPath, key: 'nokey', field: 'year' });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// delete_entry
// ---------------------------------------------------------------------------

describe('delete_entry', () => {
  it('deletes an entry and it disappears from queries', async () => {
    await callTool('create_entry', { file: bibPath, key: 'throwaway', type: 'misc', fields: {} });

    const del = await callTool('delete_entry', { file: bibPath, key: 'throwaway' });
    assert.equal(del.deletedKey, 'throwaway');

    const get = await callTool('get_entry', { file: bibPath, key: 'throwaway' });
    assert.ok(get.error, 'entry should be gone after deletion');
  });

  it('returns an error for a missing key', async () => {
    const data = await callTool('delete_entry', { file: bibPath, key: 'nosuchkey' });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// rename_key
// ---------------------------------------------------------------------------

describe('rename_key', () => {
  it('renames a key and the entry is accessible under the new key', async () => {
    await callTool('create_entry', { file: bibPath, key: 'oldkey2024', type: 'misc', fields: { title: 'Test' } });

    const data = await callTool('rename_key', { file: bibPath, oldKey: 'oldkey2024', newKey: 'newkey2024' });
    assert.equal(data.oldKey, 'oldkey2024');
    assert.equal(data.newKey, 'newkey2024');

    const found = await callTool('get_entry', { file: bibPath, key: 'newkey2024' });
    assert.equal(found.entry.key, 'newkey2024');
    assert.equal(found.entry.fields.title, 'Test');

    const gone = await callTool('get_entry', { file: bibPath, key: 'oldkey2024' });
    assert.ok(gone.error, 'old key should no longer exist');
  });

  it('preserves the entry type and all fields', async () => {
    await callTool('create_entry', { file: bibPath, key: 'preserve2024', type: 'article',
      fields: { title: 'Keep Me', author: 'Smith, A', year: '2024', journal: 'J' } });

    await callTool('rename_key', { file: bibPath, oldKey: 'preserve2024', newKey: 'preserved2024' });

    const found = await callTool('get_entry', { file: bibPath, key: 'preserved2024' });
    assert.equal(found.entry.type, 'article');
    assert.equal(found.entry.fields.title, 'Keep Me');
    assert.equal(found.entry.fields.author, 'Smith, A');
  });

  it('returns an error for a missing old key', async () => {
    const data = await callTool('rename_key', { file: bibPath, oldKey: 'nosuchkey', newKey: 'anything' });
    assert.ok(data.error);
  });

  it('returns an error when the new key already exists', async () => {
    const data = await callTool('rename_key', { file: bibPath, oldKey: 'smith2023', newKey: 'conf2022bad' });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// validate_entry
// ---------------------------------------------------------------------------

describe('validate_entry', () => {
  it('reports valid for a complete article', async () => {
    const data = await callTool('validate_entry', { file: bibPath, key: 'smith2023' });
    assert.equal(data.valid, true);
    assert.equal(data.summary.errors, 0);
  });

  it('reports errors for missing required fields', async () => {
    const data = await callTool('validate_entry', { file: bibPath, key: 'conf2022bad' });
    assert.equal(data.valid, false);
    assert.ok(data.summary.errors > 0);
    assert.ok(data.issues.some(i => i.field === 'author'));
  });

  it('returns error for unknown entry key', async () => {
    const data = await callTool('validate_entry', { file: bibPath, key: 'nosuch' });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// validate_file
// ---------------------------------------------------------------------------

describe('validate_file', () => {
  it('returns overall validity', async () => {
    const data = await callTool('validate_file', { file: bibPath });
    assert.ok(typeof data.valid === 'boolean');
    // conf2022bad is missing author — file should be invalid
    assert.equal(data.valid, false);
  });

  it('includes summary counts', async () => {
    const data = await callTool('validate_file', { file: bibPath });
    assert.ok(data.summary.entriesChecked >= 3);
    assert.ok(data.summary.errors >= 1);
  });

  it('reports per-entry issues', async () => {
    const data = await callTool('validate_file', { file: bibPath });
    const badEntry = data.results.find(r => r.key === 'conf2022bad');
    assert.ok(badEntry, 'conf2022bad should appear in results');
    assert.ok(badEntry.issues.some(i => i.severity === 'error'));
  });
});

// ---------------------------------------------------------------------------
// validate_patent – error paths (no network required)
// ---------------------------------------------------------------------------

describe('validate_patent – error paths', () => {
  it('returns an error when the entry key does not exist', async () => {
    const data = await callTool('validate_patent', { file: bibPath, key: 'nosuchkey' });
    assert.ok(data.error);
    assert.match(data.error, /not found/i);
  });

  it('returns an error when the entry has no number field', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'patno_number', type: 'patent',
      fields: { author: 'Smith, J.', title: 'Widget', year: '2023' },
    });
    const data = await callTool('validate_patent', { file: bibPath, key: 'patno_number' });
    assert.ok(data.error);
    assert.match(data.error, /number/i);
  });

  it('returns an error for a non-US patent number', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'pat_ep', type: 'patent',
      fields: { author: 'Smith, J.', title: 'Widget', year: '2023', number: 'EP1234567A1' },
    });
    const data = await callTool('validate_patent', { file: bibPath, key: 'pat_ep' });
    assert.ok(data.error);
    assert.match(data.error, /US patents/i);
  });
});

// ---------------------------------------------------------------------------
// convert_entry_type
// ---------------------------------------------------------------------------

describe('convert_entry_type', () => {
  it('converts an article to inproceedings', async () => {
    // create a fresh entry to convert
    await callTool('create_entry', {
      file: bibPath, key: 'toconvert2024', type: 'article',
      fields: { author: 'A', title: 'T', journal: 'J', year: '2024' },
    });
    const data = await callTool('convert_entry_type', {
      file: bibPath, key: 'toconvert2024', newType: 'inproceedings',
    });
    assert.equal(data.oldType, 'article');
    assert.equal(data.newType, 'inproceedings');

    const fetched = await callTool('get_entry', { file: bibPath, key: 'toconvert2024' });
    assert.equal(fetched.entry.type, 'inproceedings');
  });

  it('renames fields during conversion', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'rename2024', type: 'article',
      fields: { author: 'A', title: 'T', journal: 'Proc. of Conf', year: '2024' },
    });
    const data = await callTool('convert_entry_type', {
      file: bibPath, key: 'rename2024', newType: 'inproceedings',
      fieldRenames: { journal: 'booktitle' },
    });
    assert.ok(data.appliedRenames.some(r => r.from === 'journal' && r.to === 'booktitle'));

    const journal = await callTool('get_field', { file: bibPath, key: 'rename2024', field: 'journal' });
    assert.ok(journal.error, 'journal field should be gone');

    const booktitle = await callTool('get_field', { file: bibPath, key: 'rename2024', field: 'booktitle' });
    assert.equal(booktitle.value, 'Proc. of Conf');
  });

  it('returns validation issues introduced by the type change', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'convertbad2024', type: 'misc',
      fields: { title: 'Only a title' },
    });
    const data = await callTool('convert_entry_type', {
      file: bibPath, key: 'convertbad2024', newType: 'article',
    });
    // article requires author, journal, year — all missing
    assert.ok(Array.isArray(data.validationIssues));
    assert.ok(data.validationIssues.some(i => i.severity === 'error'));
  });

  it('returns an error for a missing entry key', async () => {
    const data = await callTool('convert_entry_type', {
      file: bibPath, key: 'nosuchkey', newType: 'article',
    });
    assert.ok(data.error);
  });

  it('returns an error for an unknown target type', async () => {
    const data = await callTool('convert_entry_type', {
      file: bibPath, key: 'smith2023', newType: 'badtype',
    });
    assert.ok(data.error);
  });

  it('ignores renames for fields that do not exist', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'renamemissing', type: 'misc', fields: { title: 'T' },
    });
    const data = await callTool('convert_entry_type', {
      file: bibPath, key: 'renamemissing', newType: 'misc',
      fieldRenames: { nonexistent: 'something' },
    });
    assert.deepEqual(data.appliedRenames, []);
  });
});

// ---------------------------------------------------------------------------
// validate_doi — error paths (no network required)
// ---------------------------------------------------------------------------

describe('validate_doi – error paths', () => {
  it('returns an error when the entry key does not exist', async () => {
    const data = await callTool('validate_doi', { file: bibPath, key: 'nosuchkey' });
    assert.ok(data.error);
    assert.match(data.error, /not found/i);
  });

  it('returns an error when the entry has no doi field', async () => {
    // smith2023 has no doi field in the original fixture
    const data = await callTool('validate_doi', { file: bibPath, key: 'jones2020' });
    assert.ok(data.error);
    assert.match(data.error, /doi/i);
  });
});

// ---------------------------------------------------------------------------
// validate_doi_batch — error paths (no network required)
// ---------------------------------------------------------------------------

describe('validate_doi_batch – no doi entries', () => {
  it('returns a summary with zero checked when no entries have doi fields', async () => {
    // Write a temp bib with no doi fields
    const nodoi = join(tmpdir(), `mcp-nodoi-${Date.now()}.bib`);
    const { writeFile: wf, unlink: ul } = await import('node:fs/promises');
    await wf(nodoi, '@misc{a, title = {No DOI here}}\n', 'utf8');
    try {
      const data = await callTool('validate_doi_batch', { file: nodoi });
      assert.equal(data.summary.checked, 0);
      assert.deepEqual(data.results, []);
    } finally {
      await ul(nodoi).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// list_entry_types
// ---------------------------------------------------------------------------

describe('list_entry_types', () => {
  it('lists all standard types including article and book', async () => {
    const data = await callTool('list_entry_types', {});
    assert.ok(Array.isArray(data.types));
    assert.ok(data.types.some(t => t.type === 'article'));
    assert.ok(data.types.some(t => t.type === 'book'));
    assert.ok(data.types.length >= 10);
  });

  it('returns schema with required and optional for each type', async () => {
    const data = await callTool('list_entry_types', {});
    const article = data.types.find(t => t.type === 'article');
    assert.ok(article);
    assert.ok(Array.isArray(article.required));
    assert.ok(Array.isArray(article.optional));
  });

  it('returns schema for a specific type', async () => {
    const data = await callTool('list_entry_types', { type: 'article' });
    assert.equal(data.type, 'article');
    assert.ok(data.required.includes('author'));
    assert.ok(data.optional.includes('doi'));
  });

  it('returns error for unknown type', async () => {
    const data = await callTool('list_entry_types', { type: 'badtype' });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// query_entries – missingField filter
// ---------------------------------------------------------------------------

describe('query_entries – missingField', () => {
  it('returns only entries missing the specified field', async () => {
    // jones2020 has a doi from earlier update_field test; smith2023 may not
    // Use a fresh temp file to control the state precisely
    const tmp = join(tmpdir(), `mcp-missing-${Date.now()}.bib`);
    await writeFile(tmp, `@article{hasdoi, author={A}, title={T}, journal={J}, year={2023}, doi={10.1234/x}}
@article{nodoi, author={B}, title={U}, journal={K}, year={2024}}
`, 'utf8');
    try {
      const data = await callTool('query_entries', { file: tmp, missingField: 'doi' });
      assert.equal(data.count, 1);
      assert.equal(data.entries[0].key, 'nodoi');
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('returns empty when all entries have the field', async () => {
    const tmp = join(tmpdir(), `mcp-allhave-${Date.now()}.bib`);
    await writeFile(tmp, `@misc{a, doi={10.1/a}}
@misc{b, doi={10.1/b}}
`, 'utf8');
    try {
      const data = await callTool('query_entries', { file: tmp, missingField: 'doi' });
      assert.equal(data.count, 0);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// update_fields
// ---------------------------------------------------------------------------

describe('update_fields', () => {
  it('updates multiple fields on a single entry', async () => {
    await callTool('update_fields', {
      file: bibPath,
      updates: { smith2023: { year: '2024', volume: '99' } },
    });
    const y = await callTool('get_field', { file: bibPath, key: 'smith2023', field: 'year' });
    const v = await callTool('get_field', { file: bibPath, key: 'smith2023', field: 'volume' });
    assert.equal(y.value, '2024');
    assert.equal(v.value, '99');
  });

  it('updates fields across multiple entries in one call', async () => {
    await callTool('create_entry', { file: bibPath, key: 'bulk1', type: 'misc', fields: { title: 'A' } });
    await callTool('create_entry', { file: bibPath, key: 'bulk2', type: 'misc', fields: { title: 'B' } });

    const data = await callTool('update_fields', {
      file: bibPath,
      updates: {
        bulk1: { title: 'Updated A' },
        bulk2: { title: 'Updated B' },
      },
    });
    assert.equal(data.updated, 2);

    const a = await callTool('get_field', { file: bibPath, key: 'bulk1', field: 'title' });
    const b = await callTool('get_field', { file: bibPath, key: 'bulk2', field: 'title' });
    assert.equal(a.value, 'Updated A');
    assert.equal(b.value, 'Updated B');
  });

  it('returns an error if any entry key does not exist', async () => {
    const data = await callTool('update_fields', {
      file: bibPath,
      updates: { nosuchkey: { year: '2000' } },
    });
    assert.ok(data.error);
    assert.match(data.error, /not found/i);
  });
});

// ---------------------------------------------------------------------------
// replace_entry
// ---------------------------------------------------------------------------

describe('replace_entry', () => {
  it('replaces all fields and type in one call', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'toreplace', type: 'misc',
      fields: { title: 'Old Title', year: '2020', note: 'Old note' },
    });

    await callTool('replace_entry', {
      file: bibPath, key: 'toreplace', type: 'book',
      fields: { title: 'New Title', author: 'Someone', publisher: 'Press', year: '2025' },
    });

    const entry = await callTool('get_entry', { file: bibPath, key: 'toreplace' });
    assert.equal(entry.entry.type, 'book');
    assert.equal(entry.entry.fields.title, 'New Title');
    assert.equal(entry.entry.fields.year, '2025');
    assert.equal(entry.entry.fields.note, undefined, 'old fields should be gone');
  });

  it('keeps existing type when type is omitted', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'keeptype', type: 'article',
      fields: { author: 'A', title: 'T', journal: 'J', year: '2023' },
    });
    await callTool('replace_entry', {
      file: bibPath, key: 'keeptype',
      fields: { author: 'B', title: 'U', journal: 'K', year: '2024' },
    });
    const entry = await callTool('get_entry', { file: bibPath, key: 'keeptype' });
    assert.equal(entry.entry.type, 'article');
    assert.equal(entry.entry.fields.author, 'B');
  });

  it('returns an error for a missing entry key', async () => {
    const data = await callTool('replace_entry', {
      file: bibPath, key: 'nosuchkey', fields: { title: 'X' },
    });
    assert.ok(data.error);
  });

  it('returns an error for an unknown type', async () => {
    const data = await callTool('replace_entry', {
      file: bibPath, key: 'smith2023', type: 'badtype', fields: { title: 'X' },
    });
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// lookup_doi_by_metadata — error paths (no network required)
// ---------------------------------------------------------------------------

describe('lookup_doi_by_metadata – error path', () => {
  it('returns an error when neither title nor author is supplied', async () => {
    const data = await callTool('lookup_doi_by_metadata', {});
    assert.ok(data.error);
    assert.match(data.error, /title or author/i);
  });
});

// ---------------------------------------------------------------------------
// fix_from_doi — error paths (no network required)
// ---------------------------------------------------------------------------

describe('fix_from_doi – error paths', () => {
  it('returns an error when the entry key does not exist', async () => {
    const data = await callTool('fix_from_doi', { file: bibPath, key: 'nosuchkey' });
    assert.ok(data.error);
    assert.match(data.error, /not found/i);
  });

  it('returns an error when the entry has no doi field', async () => {
    await callTool('create_entry', {
      file: bibPath, key: 'nodoi_fix', type: 'misc', fields: { title: 'No DOI' },
    });
    const data = await callTool('fix_from_doi', { file: bibPath, key: 'nodoi_fix' });
    assert.ok(data.error);
    assert.match(data.error, /doi/i);
  });
});

// ---------------------------------------------------------------------------
// validate_doi_batch — severity summary fields
// ---------------------------------------------------------------------------

describe('validate_doi_batch – severity summary', () => {
  it('summary includes withSubstantive, withCosmeticOnly, and lookupErrors fields', async () => {
    const tmp = join(tmpdir(), `mcp-batch-sev-${Date.now()}.bib`);
    await writeFile(tmp, '@misc{a, title = {No DOI}}\n', 'utf8');
    try {
      const data = await callTool('validate_doi_batch', { file: tmp });
      assert.ok('withSubstantive'  in data.summary, 'summary should have withSubstantive');
      assert.ok('withCosmeticOnly' in data.summary, 'summary should have withCosmeticOnly');
      assert.ok('lookupErrors'     in data.summary, 'summary should have lookupErrors');
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// query_entries – keysOnly (explicit and auto)
// ---------------------------------------------------------------------------

describe('query_entries – keysOnly explicit', () => {
  it('keysOnly: true returns entries with key and type but no fields', async () => {
    const data = await callTool('query_entries', { file: bibPath, keysOnly: true });
    assert.ok(data.entries.length > 0);
    for (const e of data.entries) {
      assert.ok('key'  in e, 'entry should have key');
      assert.ok('type' in e, 'entry should have type');
      assert.ok(!('fields' in e), 'entry should not have fields when keysOnly: true');
    }
    assert.equal(data.keysOnly, true);
  });

  it('keysOnly: false returns full fields regardless of result count', async () => {
    const data = await callTool('query_entries', { file: bibPath, keysOnly: false });
    assert.ok(data.entries.length > 0);
    for (const e of data.entries) {
      assert.ok('fields' in e, 'entry should have fields when keysOnly: false');
    }
    assert.equal(data.keysOnly, false);
  });
});

describe('query_entries – keysOnly auto-mode', () => {
  // Build a temp bib with more than 20 entries to trigger auto keys-only
  let largeBibPath;

  before(async () => {
    largeBibPath = join(tmpdir(), `mcp-large-${Date.now()}.bib`);
    const entries = Array.from({ length: 25 }, (_, i) =>
      `@misc{entry${i}, title = {Entry ${i}}, year = {2020}}`
    ).join('\n\n');
    await writeFile(largeBibPath, entries, 'utf8');
  });

  after(async () => {
    await unlink(largeBibPath).catch(() => {});
  });

  it('auto-switches to keys-only and includes a note when results exceed threshold', async () => {
    const data = await callTool('query_entries', { file: largeBibPath });
    assert.equal(data.total, 25);
    assert.equal(data.keysOnly, true);
    assert.ok(data.note, 'should include a note explaining the auto-switch');
    assert.match(data.note, /keys only/i);
    for (const e of data.entries) {
      assert.ok(!('fields' in e), 'entries should not have fields in auto keys-only mode');
    }
  });

  it('auto-mode returns full fields when results are at or below the threshold', async () => {
    // Query with limit: 5 so the page is small enough for auto full-fields
    const data = await callTool('query_entries', { file: largeBibPath, limit: 5 });
    assert.equal(data.count, 5);
    assert.equal(data.keysOnly, false);
    assert.ok(!data.note, 'should not include a note for small result sets');
    for (const e of data.entries) {
      assert.ok('fields' in e, 'entries should have fields for small result sets');
    }
  });

  it('keysOnly: false overrides auto-mode even for large result sets', async () => {
    const data = await callTool('query_entries', { file: largeBibPath, keysOnly: false });
    assert.equal(data.keysOnly, false);
    assert.ok(!data.note, 'no auto-switch note when caller forced full fields');
    for (const e of data.entries) {
      assert.ok('fields' in e, 'full fields should be present when keysOnly: false');
    }
  });
});

// ---------------------------------------------------------------------------
// query_entries – limit and offset
// ---------------------------------------------------------------------------

describe('query_entries – limit and offset', () => {
  let pageBibPath;

  before(async () => {
    pageBibPath = join(tmpdir(), `mcp-page-${Date.now()}.bib`);
    // 10 articles with predictable keys: page0 … page9
    const entries = Array.from({ length: 10 }, (_, i) =>
      `@article{page${i}, author={Author}, title={Paper ${i}}, journal={J}, year={202${i % 10}}}`
    ).join('\n\n');
    await writeFile(pageBibPath, entries, 'utf8');
  });

  after(async () => {
    await unlink(pageBibPath).catch(() => {});
  });

  it('limit restricts the number of returned entries', async () => {
    const data = await callTool('query_entries', { file: pageBibPath, limit: 3, keysOnly: true });
    assert.equal(data.count, 3);
    assert.equal(data.total, 10);
  });

  it('offset skips the first N entries', async () => {
    const all  = await callTool('query_entries', { file: pageBibPath, keysOnly: true });
    const rest = await callTool('query_entries', { file: pageBibPath, offset: 2, keysOnly: true });
    assert.equal(rest.total, 10);
    assert.equal(rest.count, 8);
    assert.equal(rest.entries[0].key, all.entries[2].key);
  });

  it('limit and offset together implement paging', async () => {
    const page1 = await callTool('query_entries', { file: pageBibPath, limit: 4, offset: 0, keysOnly: true });
    const page2 = await callTool('query_entries', { file: pageBibPath, limit: 4, offset: 4, keysOnly: true });
    const page3 = await callTool('query_entries', { file: pageBibPath, limit: 4, offset: 8, keysOnly: true });

    assert.equal(page1.count, 4);
    assert.equal(page2.count, 4);
    assert.equal(page3.count, 2); // only 2 remain

    // No key appears twice across pages
    const allKeys = [...page1.entries, ...page2.entries, ...page3.entries].map(e => e.key);
    assert.equal(new Set(allKeys).size, 10);
  });

  it('total always reflects the full unsliced count', async () => {
    const data = await callTool('query_entries', { file: pageBibPath, limit: 1, offset: 5, keysOnly: true });
    assert.equal(data.total, 10);
    assert.equal(data.count, 1);
    assert.equal(data.offset, 5);
  });

  it('offset beyond the result set returns empty entries', async () => {
    const data = await callTool('query_entries', { file: pageBibPath, offset: 100, keysOnly: true });
    assert.equal(data.total, 10);
    assert.equal(data.count, 0);
    assert.deepEqual(data.entries, []);
  });
});

// ---------------------------------------------------------------------------
// fill_missing_dois
// ---------------------------------------------------------------------------

describe('fill_missing_dois – listed in tools', () => {
  it('fill_missing_dois is listed as an available tool', async () => {
    const result = await client.listTools();
    const names = result.tools.map(t => t.name);
    assert.ok(names.includes('fill_missing_dois'), 'fill_missing_dois should be listed');
  });
});

describe('fill_missing_dois – offline behaviour', () => {
  let fillBibPath;

  before(async () => {
    fillBibPath = join(tmpdir(), `mcp-fill-${Date.now()}.bib`);
    await writeFile(fillBibPath, `\
@article{hasdoi2023,
  author = {Smith, A.},
  title = {Already Has DOI},
  journal = {J},
  year = {2023},
  doi = {10.1234/existing}
}

@misc{notitlenoauthor,
  year = {2020}
}
`, 'utf8');
  });

  after(async () => {
    await unlink(fillBibPath).catch(() => {});
  });

  it('returns correct top-level summary fields', async () => {
    const data = await callTool('fill_missing_dois', { file: fillBibPath, dryRun: true });
    assert.ok('totalMissingDoi' in data, 'should report totalMissingDoi');
    assert.ok('processed'       in data, 'should report processed');
    assert.ok('filled'          in data, 'should report filled');
    assert.ok('unmatched'       in data, 'should report unmatched');
    assert.ok('errors'          in data, 'should report errors');
    assert.ok('dryRun'          in data, 'should report dryRun flag');
    assert.ok('details'         in data, 'should report details');
  });

  it('excludes entries that already have a doi', async () => {
    const data = await callTool('fill_missing_dois', { file: fillBibPath, dryRun: true });
    // hasdoi2023 has a doi — only notitlenoauthor should be considered
    assert.equal(data.totalMissingDoi, 1);
  });

  it('reports entries with no title or author as unmatched', async () => {
    const data = await callTool('fill_missing_dois', { file: fillBibPath, dryRun: true });
    const u = data.details.unmatched.find(e => e.key === 'notitlenoauthor');
    assert.ok(u, 'notitlenoauthor should appear in unmatched');
    assert.match(u.reason, /title or author/i);
  });

  it('dryRun: true does not write doi to file', async () => {
    const tmp = join(tmpdir(), `mcp-dryrun-${Date.now()}.bib`);
    // An entry Crossref would likely find — but we use a very low threshold
    // so it might be filled. We verify dryRun prevents the write regardless.
    await writeFile(tmp, `\
@misc{nodoi_dry,
  title = {Unique Unlikely Paper Title XYZ123},
  year = {2020}
}
`, 'utf8');
    try {
      const before = await readFile(tmp, 'utf8');
      await callTool('fill_missing_dois', { file: tmp, dryRun: true, threshold: 0 });
      const after = await readFile(tmp, 'utf8');
      assert.equal(before, after, 'file should be unchanged after dryRun');
      assert.ok(!after.includes('doi = {'), 'no doi field should be written on dryRun');
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('type filter restricts which entries are considered', async () => {
    const tmp = join(tmpdir(), `mcp-typefilter-${Date.now()}.bib`);
    await writeFile(tmp, `\
@article{art1, author={A}, title={Paper}, journal={J}, year={2020}}
@inproceedings{conf1, author={B}, title={Talk}, booktitle={Conf}, year={2021}}
`, 'utf8');
    try {
      const data = await callTool('fill_missing_dois', {
        file: tmp, type: 'article', dryRun: true,
      });
      assert.equal(data.totalMissingDoi, 1);
      const keys = [
        ...data.details.filled,
        ...data.details.unmatched,
        ...data.details.errors,
      ].map(e => e.key);
      assert.ok(!keys.includes('conf1'), 'conf1 should not be processed when type=article');
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  it('limit and offset restrict which entries are processed', async () => {
    const tmp = join(tmpdir(), `mcp-fillpage-${Date.now()}.bib`);
    // 4 entries, all missing doi, all without title/author so they go to unmatched quickly
    const content = [0, 1, 2, 3].map(i => `@misc{fillkey${i}, year={202${i}}}`).join('\n');
    await writeFile(tmp, content, 'utf8');
    try {
      const data = await callTool('fill_missing_dois', {
        file: tmp, dryRun: true, limit: 2, offset: 1,
      });
      assert.equal(data.totalMissingDoi, 4);
      assert.equal(data.processed, 2);
      assert.equal(data.offset, 1);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });
});
