#!/usr/bin/env node

const yargs = require('yargs');
const path = require('path');
const yeoman = require('yeoman-environment');
const child_process = require("child_process");

async function parseArgs() {
  return yargs
    .scriptName('pct')
    .usage('Usage: pct COMMAND [args]')
    .command(['init [PROJECT_DIR] [CONNECTOR_NAME] [CLIENT_ID]'], 'Initialize an empty project', yargs => yargs)
    .command(['save [APP_PATH]'], 'Save your entire connector in the form of json', yargs => yargs)
    // TODO .command(['run [APP_PATH]'], 'Run your connector app', yargs => yargs)
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
      init(argv.PROJECT_DIR, argv.CONNECTOR_NAME, argv.CLIENT_ID);
      break;
    case 'run':
      await run(argv.APP_PATH);
      break;
    case 'save':
      await save(argv.APP_PATH);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
  }
}

function init(dir, name, clientId) {
  const env = yeoman.createEnv();
  const generatorPath = path.join(__dirname, '../generator/index.js');
  env.register(generatorPath, 'imodeljs:connector');

  dir = dir ? dir : 'MyProject';
  name = name ? name : '';
  clientId = clientId ? clientId : '';
  args = `imodeljs:connector ${dir} ${name} ${clientId}`;
  env.run(args, () => {});
}

function getAppInstance(p) {
  p = p ? p : "lib/App.js";
  const appModule = require(path.join(process.cwd(), p));
  const app = appModule.getAppInstance();
  return app;
}

async function run(p) {
  const app = getAppInstance(p);
  await app.run();
}

async function save(p) {
  const app = getAppInstance(p);
  await app.saveConnector();
}

main();

