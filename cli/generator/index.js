/*---------------------------------------------------------------------------------------------
* Copyright (c) 2020 Bentley Systems, Incorporated. All rights reserved.
*--------------------------------------------------------------------------------------------*/
const Generator = require("yeoman-generator");
const chalk = require("chalk");
const path = require("path");
const glob = require("glob");
const semver = require("semver");
const latestVersion = require("latest-version");
const { pascalCase } = require("pascal-case");
const { paramCase } = require("param-case");

const logo = `
${chalk.blue("               ,╖║▒▒║  ")}${chalk.cyan(" ┌╗╖        ")}
${chalk.blue("            .╓║▒╝╙     ")}${chalk.cyan(" ,╓,  ,╓╖╖, ")}
${chalk.blue("         ╓@▒║╜         ")}${chalk.cyan(" ]▒[ ║▒║ ╙╙*")}
${chalk.blue("      ╖║║╜`       ╓║║╖ ")}${chalk.cyan(" ]▒[  ╙╜╝║║╗")}
${chalk.blue("     ║▒`          ║▒▒║ ")}${chalk.cyan(" ]▒[ ╙▒║╖║▒╜")}
${chalk.blue("     ▒▒         ╓      ")}${chalk.cyan("╖║▒┘        ")}
${chalk.blue("     ▒▒         ▒▒║╥,            ▒▒")}
${chalk.blue("     ▒▒         ╙╝▒▒▒▒           ▒▒")}
${chalk.blue("     ▒▒           ║▒▒▒           ▒▒")}
${chalk.blue("     ▒▒           ║▒▒▒           ▒▒")}
${chalk.blue("     ▒▒      ┌╖,  ║▒▒▒  ,╖┐      ▒▒")}
${chalk.blue("     ╙▒║╖    ]▒▒▒║║▒▒▒║▒▒▒[    ╓║▒╜")}
${chalk.blue("        ╙║║╗╖  ╙║▒▒▒▒▒▒║╜` ╓╥║║╜`  ")}
${chalk.blue("           `╙║║╖, `╙╜` ,╖║▒╜`      ")}
${chalk.blue("               \"╜▒║╖╖║▒╝╙          ")}
${chalk.blue("                   ``              ")}`;

const getNameUsage = (answers) => `${chalk.grey("  OK! We'll use this for the following values in your project:")}
    ${chalk.grey("⁃ Module Name:")} ${chalk.green(pascalCase(answers.name) + ".ts")}
    ${chalk.grey("⁃ Package Name:")} ${chalk.green(answers.name)}
`;

module.exports = class extends Generator {
  constructor(args, opts) {
    super(args, opts);

    try {
      this.argument("directory", { type: String, required: true });
    } catch (error) {
      console.error("Please specify the project directory:");
      console.error(`  ${chalk.cyan("npm init imodeljs-connector")} ${chalk.green("<project-directory>")}`);
      console.error("\nFor example:");
      console.error(`  ${chalk.cyan("npx yo imodeljs-connector")} ${chalk.green("my-connector")}`);
      process.exit(1);
    }
  }

  async initializing() {
    this.destinationRoot(path.resolve(this.contextRoot, this.options.directory));

    this._defaultNodeVersion = semver.satisfies(process.versions.node, "12.x") ? process.versions.node : "12.18.4";
    this._latestIMJSVersion = await latestVersion("@bentley/imodeljs-common");
    if (this.options.imjsversion !== undefined &&
      !semver.satisfies(this.options.imjsversion, '2.x', { includePrerelease: true }) &&
      this.options.imjsversion !== "latest") {
      throw "imjsversion semver is not valid. Connector generator supports only 2.x. version of imjs packages";
    }

    if (this.options.nodeversion === "default") {
      this.options.nodeversion = this._defaultNodeVersion;
    }

    if (this.options.imjsversion === "latest") {
      this.options.imjsversion = this._latestIMJSVersion;
    }
  }

  async prompting() {
    this.log(logo);
    this.log(chalk.bold(`Welcome to the ${chalk.cyan("iModel.js Connecter")} generator!\n`));

    const logDuringPrompts = (messageOrCallback) => {
      return {
        when: (answers) => {
          const message = (typeof (messageOrCallback) === "string") ? messageOrCallback : messageOrCallback(answers)
          this.log(message);
          return false;
        },
      }
    }

    this.answers = await this.prompt([
      {
        name: "name",
        message: "What\'s the name of your Connector? (Use a unique, descriptive name.",
        default: paramCase(path.basename(this.destinationRoot())),
        when: () => !this.options.name,
        filter: (v) => paramCase(v),
        transformer: (v) => chalk.cyan(paramCase(v)),
      },
      this.options.name ? { when: () => false } : logDuringPrompts(getNameUsage),

      {
        name: "clientId",
        message: "What\'s your Client ID?",
        default: "",
        when: () => !this.options.clientId,
      },
      {
        name: "clientRedirectUri",
        message: "What\'s your Client Redirect URI?",
        default: "http://localhost:3000/signin-callback",
        when: () => !this.options.clientRedirectUri,
      },
      {
        name: "clientScope",
        message: "Enter Client scopes you want to define?",
        default: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
        when: () => !this.options.clientScope,
      },
    ]);
  }

  async writing() {
    this.log("\nGenerating pcf connector template...");
    let files = glob.sync("**/*", { cwd: this.sourceRoot(), nodir: true, dot: true });

    this.log(files);
    const answerName = this.answers.name || this.options.name;
    const templateData = {

      name: answerName,
      capsName: answerName.replace(/-/g, " ").toUpperCase(),
      className: pascalCase(answerName),

      clientId: this.answers.clientId || this.options.clientId || "",
      clientScope: this.answers.clientScope || this.options.clientScope,
      clientRedirectUri: this.answers.clientRedirectUri || this.options.clientRedirectUri,

      imjsversion: "^2.16.0",
      pcfversion: "0.0.1",
    };

    files.forEach((file) => {
      let destPath = this.destinationPath(file);
      const srcPath = this.templatePath(file);

      if (destPath.match(/.*ClassName(\.test)?\.ts$/))
        destPath = replaceFileName(destPath, "ClassName", templateData.className);
      else if (destPath.match(/.*gitignore$/))
        destPath = replaceFileName(destPath, "gitignore", ".gitignore");

      this.fs.copyTpl(srcPath, destPath, templateData);
      return;
    }, this);
  }

  install() {
    this.installDependencies({
      npm: true,
      bower: false,
      yarn: false,
    });
  }

  end() {
    this.log(chalk.bold.green(`Finished!`));
  }
};

function replaceFileName(fullpath, searchValue, replaceValue) {
  return path.join(path.dirname(fullpath), path.basename(fullpath).replace(searchValue, replaceValue));
}

function paramCaseWithSlash(input) {
  return paramCase(input, { stripRegexp: /[^A-Z0-9/]+/gi });
}


