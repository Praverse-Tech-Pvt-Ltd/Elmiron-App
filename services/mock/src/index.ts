import { startMockServer } from './server.js';

const { url } = await startMockServer();

console.log(
  [
    `Mock API listening on ${url}`,
    '',
    'Scenarios: send x-mock-scenario, or ?_scenario=',
    '  populated (default) · single · empty · offline-sync',
    '  denied · unauthenticated · validation · conflict · rate-limited · error',
    '',
    `Try: curl ${url}/visits`,
    `     curl -H "x-mock-scenario: empty" ${url}/visits`,
    `     curl -H "x-mock-scenario: denied" ${url}/visits`,
    `     curl "${url}/sync/queue"`,
  ].join('\n'),
);
