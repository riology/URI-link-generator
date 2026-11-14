#!/usr/bin/env node
const fs = require('fs');
const { processRawInput } = require('./src/vpnCore');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  node cli.js [input-file] [--core all|singbox|xray] [--format raw|base64|singbox-json|xray-json] [--dedup] [--prefix NAME]

Examples:
  node cli.js nodes.txt --core singbox --format base64
  node cli.js nodes.txt --core xray --format xray-json
`);
  process.exit(0);
}

function getFlagValue(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const targetCore = getFlagValue('--core', 'all');
const format = getFlagValue('--format', 'raw');
const remarkPrefix = getFlagValue('--prefix', '');
const deduplicate = args.includes('--dedup');

const fileArg = args.find((a) => !a.startsWith('-'));
let inputText = '';

if (fileArg && fs.existsSync(fileArg)) {
  inputText = fs.readFileSync(fileArg, 'utf8');
} else {
  try {
    inputText = fs.readFileSync(0, 'utf8');
  } catch {
    console.error('Error: Provide an input file or pipe raw VPN links/Base64 via stdin.');
    process.exit(1);
  }
}

const result = processRawInput(inputText, {
  targetCore,
  deduplicate,
  remarkPrefix,
});

if (format === 'base64') {
  console.log(result.outputs.base64);
} else if (format === 'singbox-json') {
  console.log(result.outputs.singBoxJson);
} else if (format === 'xray-json') {
  console.log(result.outputs.xrayJson);
} else {
  console.log(result.outputs.rawUris);
}
