/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
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
    ${chalk.grey("⁃ Module Name:")} ${chalk.green(pascalCase(answers.connectorName) + ".ts")}
    ${chalk.grey("⁃ Package Name:")} ${chalk.green(answers.connectorName)}
`;

module.exports = class extends Generator {
  constructor(args, opts) {
    super(args, opts);

    this.argument("projectName", { type: String, required: true });
    this.argument("connectorName", { type: String, required: false });
    this.argument("clientId", { type: String, required: false });
    this.argument("clientRedirectUri", { type: String, required: false });
    this.argument("clientScope", { type: String, required: false });
    this.argument("projectId", { type: String, required: false });
    this.argument("iModelId", { type: String, required: false });
  }

  async initializing() {
    this.destinationRoot(path.resolve(this.contextRoot, this.options.projectName));
    if (semver.lt(process.versions.node, "12.17.0") || semver.gte(process.versions.node, "15.0.0")) {
      const msg = "Your Node.js version must be >=12.17.0 <15.0.0";
      this.log(msg);
      throw msg;
    }
  }

  async prompting() {
    this.log(logo);
    this.log(chalk.bold(`Welcome to the ${chalk.cyan("iTwin Connecter")} generator!\n`));

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
        name: "connectorName",
        message: "What\'s the name of your connector?",
        default: "MyConnector",
        when: () => !this.options.connectorName,
        filter: (v) => paramCase(v),
        transformer: (v) => chalk.cyan(paramCase(v)),
        required: true,
      },
      this.options.connectorName ? { when: () => false } : logDuringPrompts(getNameUsage),
      {
        name: "clientId",
        message: "What\'s your Client ID?",
        default: "",
        when: () => !this.options.clientId,
        required: true,
      },
      {
        name: "clientRedirectUri",
        message: "What\'s your Client Redirect URI?",
        default: "http://localhost:3000/signin-callback",
        when: () => !this.options.clientRedirectUri,
        required: true,
      },
      {
        name: "clientScope",
        message: "What\'s your Client Scope?",
        default: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
        when: () => !this.options.clientScope,
        required: true,
      },
      {
        name: "projectId",
        message: "What\'s your project ID?",
        default: "",
        when: () => !this.options.projectId,
        required: false,
      },
      {
        name: "iModelId",
        message: "What\'s your iModel ID?",
        default: "",
        when: () => !this.options.iModelId,
        required: false,
      },
    ]);
  }

  async writing() {
    this.log("\nGenerating PCF connector template...");
    let files = glob.sync("**/*", { cwd: this.sourceRoot(), nodir: true, dot: true });

    this.log(files);
    const connectorName = this.answers.connectorName || this.options.connectorName;

    const templateData = {
      name: connectorName,
      capsName: connectorName.replace(/-/g, " ").toUpperCase(),
      packageName: connectorName,
      className: pascalCase(connectorName),
      clientId: this.answers.clientId || this.options.clientId || "",
      clientRedirectUri: this.answers.clientRedirectUri || this.options.clientRedirectUri || "",
      clientScope: this.answers.clientScope || this.options.clientScope || "",
      projectId: this.answers.projectId || this.options.projectId || "",
      iModelId: this.answers.iModelId || this.options.iModelId || "",
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


