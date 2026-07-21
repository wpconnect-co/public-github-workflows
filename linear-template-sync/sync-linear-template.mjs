#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql';
const CONFIG_PATH = '.github/linear-template.json';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Unable to read JSON ${filePath}: ${error.message}`);
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  } catch (error) {
    fail(`Unable to read source ${filePath}: ${error.message}`);
  }
}

function assertConfig(config) {
  if (!config.linearTemplateId) fail('linearTemplateId is required in .github/linear-template.json');
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    fail('sources[] is required in .github/linear-template.json');
  }

  if (config.type === 'wordpress-org-free-plugin') {
    const sourcePaths = config.sources.map((source) => source.path);
    for (const required of ['readme.txt', 'changelog.txt']) {
      if (!sourcePaths.includes(required)) {
        fail(`wordpress-org-free-plugin templates must include ${required}`);
      }
    }
  }

  for (const source of config.sources) {
    if (!source.label || !source.path) fail('Each source requires label and path');
    if (source.format && source.format !== 'plaintext') {
      fail(`Unsupported source format ${source.format}; only plaintext is supported`);
    }
    if (!fs.existsSync(source.path)) fail(`Source file not found: ${source.path}`);
  }
}

function buildDescriptionData(config) {
  const content = [];

  for (const source of config.sources) {
    content.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: source.label }],
    });

    const text = readText(source.path);
    content.push({
      type: 'code_block',
      attrs: { language: source.format || 'plaintext' },
      content: text ? [{ type: 'text', text }] : [],
    });
  }

  return { type: 'doc', content };
}

function validateWordPressOrgFreePlugin(config) {
  if (config.type !== 'wordpress-org-free-plugin') return;

  const readmeSource = config.sources.find((source) => source.path === 'readme.txt');
  const changelogSource = config.sources.find((source) => source.path === 'changelog.txt');
  const readme = readText(readmeSource.path);
  const changelog = readText(changelogSource.path);

  const checks = [
    ['readme.txt has Stable tag', /^Stable tag:\s*\S+/m.test(readme)],
    ['readme.txt has Description section', readme.includes('== Description ==')],
    ['changelog.txt is not empty', changelog.trim().length > 0],
  ];

  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failed.length > 0) {
    fail(`Validation failed: ${failed.join('; ')}`);
  }
}

async function linearGraphql(query, variables) {
  const token = process.env.LINEAR_API_KEY;
  if (!token) fail('LINEAR_API_KEY is required for Linear API access');

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || json?.errors) {
    fail(`Linear API error: ${JSON.stringify(json?.errors || json, null, 2)}`);
  }

  return json.data;
}

function parseTemplateData(rawTemplateData) {
  if (!rawTemplateData) return {};
  if (typeof rawTemplateData === 'string') return JSON.parse(rawTemplateData);
  return rawTemplateData;
}

async function main() {
  const config = readJson(CONFIG_PATH);
  assertConfig(config);
  validateWordPressOrgFreePlugin(config);

  const descriptionData = buildDescriptionData(config);
  const sourceBytes = config.sources.map((source) => ({
    label: source.label,
    path: source.path,
    bytes: fs.statSync(source.path).size,
  }));

  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log(`Template: ${config.linearTemplateName || config.linearTemplateId}`);
  console.log(`Sources: ${sourceBytes.map((source) => `${source.path} (${source.bytes} bytes)`).join(', ')}`);

  if (!process.env.LINEAR_API_KEY) {
    if (apply) fail('LINEAR_API_KEY is required for --apply');
    console.log('LINEAR_API_KEY missing: validated local files only; skipped Linear fetch/update.');
    return;
  }

  const templateData = await linearGraphql(
    `query GetTemplate($id: String!) {
      template(id: $id) {
        id
        name
        type
        templateData
        updatedAt
      }
    }`,
    { id: config.linearTemplateId },
  );

  const template = templateData.template;
  if (!template) fail(`Linear template not found: ${config.linearTemplateId}`);
  if (template.type !== 'document') fail(`Expected document template, got ${template.type}`);

  const parsedTemplateData = parseTemplateData(template.templateData);
  parsedTemplateData.title = parsedTemplateData.title || template.name || config.linearTemplateName;
  parsedTemplateData.descriptionData = descriptionData;

  console.log(`Linear template found: ${template.name} (${template.id})`);
  console.log(`Current updatedAt: ${template.updatedAt}`);

  if (dryRun) {
    console.log(`Dry run OK: would update ${config.sources.length} source blocks.`);
    return;
  }

  const updateData = await linearGraphql(
    `mutation UpdateTemplate($id: String!, $input: TemplateUpdateInput!) {
      templateUpdate(id: $id, input: $input) {
        success
        template {
          id
          name
          type
          updatedAt
        }
      }
    }`,
    {
      id: config.linearTemplateId,
      input: {
        name: config.linearTemplateName,
        templateData: parsedTemplateData,
      },
    },
  );

  if (!updateData.templateUpdate.success) fail('Linear templateUpdate returned success=false');
  const updated = updateData.templateUpdate.template;
  console.log(`Linear template updated: ${updated.name} (${updated.id}) updatedAt=${updated.updatedAt}`);
}

main().catch((error) => fail(error.stack || error.message));
