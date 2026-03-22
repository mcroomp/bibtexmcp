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
      'create_entry', 'update_field', 'delete_field', 'delete_entry',
      'validate_entry', 'validate_file',
      'validate_doi', 'validate_doi_batch',
      'convert_entry_type', 'list_entry_types',
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
