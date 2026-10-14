#!/usr/bin/env node
// web-to-figma preflight — Node and agent-browser. Figma MCP cannot be checked from a shell;
// the agent checks for its tools separately.
const { execFileSync } = require('child_process');

let abVersion = null;
try { abVersion = execFileSync('agent-browser', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim(); } catch { /* missing */ }
const nodeOk = Number(process.versions.node.split('.')[0]) >= 18;

const out = {
  node: { version: process.versions.node, ok: nodeOk },
  agentBrowser: { installed: !!abVersion, version: abVersion },
  ok: nodeOk && !!abVersion,
  hints: [
    ...(nodeOk ? [] : ['Node.js 18 이상이 필요합니다']),
    ...(abVersion ? [] : ['agent-browser가 필요합니다: `npm i -g agent-browser && agent-browser install`']),
  ],
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
