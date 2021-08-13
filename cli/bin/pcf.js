#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

const yargs = require('yargs');
const path = require('path');
const yeoman = require('yeoman-environment');

async function parseArgs() {
  return yargs
    .scriptName('pcf')
    .usage('Usage: pcf COMMAND [args]')
    .command(['init <PROJECT_NAME> [CONNECTOR_NAME] [CLIENT_ID]'], 'Initialize a connector template', yargs => yargs)
    .demandCommand()
    .help()
    .alias('h', 'help')
    .argv;
}

async function main() {

  const argv = await parseArgs();
  const cmd = argv._[0];

  switch(cmd) {
    case 'init':
      init(argv.PROJECT_NAME, argv.CONNECTOR_NAME, argv.CLIENT_ID);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
  }
}

function init(projectName, connectorName, clientId) {
  const env = yeoman.createEnv();
  const generatorPath = path.join(__dirname, '../generator/index.js');
  env.register(generatorPath, 'pcf:connector');

  projectName = projectName ? projectName : 'GeneratedProject';
  connectorName = connectorName ? connectorName : '';
  clientId = clientId ? clientId : '';
  args = `pcf:connector ${projectName} ${connectorName} ${clientId}`;
  env.run(args, () => {});
}

try {
  main();
} catch (err) {
  console.log(err);
}

