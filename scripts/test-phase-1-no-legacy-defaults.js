'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const workspaceRoot = path.join(backendRoot, '..');
const activeRoots = [
  path.join(backendRoot, 'src'),
  path.join(workspaceRoot, 'pamana-frontend', 'app'),
];

const sourceExtensions = new Set(['.js', '.ts', '.vue', '.json']);
const prohibitedActiveDefaults = [/SL-SF-01/i, /San[ -]Luis/i];
const violations = [];

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      scan(absolutePath);
      continue;
    }

    if (!sourceExtensions.has(path.extname(entry.name))) continue;

    const source = fs.readFileSync(absolutePath, 'utf8');
    for (const pattern of prohibitedActiveDefaults) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(workspaceRoot, absolutePath)} matches ${pattern}`);
      }
    }
  }
}

activeRoots.forEach(scan);
assert.deepStrictEqual(
  violations,
  [],
  `Legacy corridor defaults remain in active source:\n${violations.join('\n')}`
);

const aiController = fs.readFileSync(
  path.join(backendRoot, 'src', 'api', 'pamana-ai', 'controllers', 'pamana-ai.js'),
  'utf8'
);
assert.match(aiController, /if \(!routeParam\) return null;/);
assert.doesNotMatch(aiController, /anyActiveRoute|pilotRoute/);

const tripSearchRoute = fs.readFileSync(
  path.join(backendRoot, 'src', 'api', 'trip-search', 'routes', 'trip-search.js'),
  'utf8'
);
assert.match(tripSearchRoute, /path: '\/trip-search'/);

const passengerHome = fs.readFileSync(
  path.join(workspaceRoot, 'pamana-frontend', 'app', 'pages', 'passenger', 'index.vue'),
  'utf8'
);
assert.match(passengerHome, /const fromLocation = ref\(''\)/);

const tripPlanner = fs.readFileSync(
  path.join(workspaceRoot, 'pamana-frontend', 'app', 'pages', 'passenger', 'trip-planner.vue'),
  'utf8'
);
assert.match(tripPlanner, /origin: '',\s*destination: ''/);
assert.match(tripPlanner, /if \(loadLocationsFromQuery\(\)\)/);

const driverDashboard = fs.readFileSync(
  path.join(workspaceRoot, 'pamana-frontend', 'app', 'pages', 'driver', 'index.vue'),
  'utf8'
);
assert.match(driverDashboard, /selectedRouteId = ref<number \| null>\(null\)/);
assert.match(driverDashboard, /route: selectedRouteId\.value/);

console.log('ok - active source contains no former-corridor defaults');
console.log('ok - prediction APIs require an explicit active route');
console.log('ok - passenger and driver flows have no automatic route fallback');
console.log('ok - /api/trip-search remains registered');
