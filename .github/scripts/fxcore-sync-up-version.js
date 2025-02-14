const path = require("path");
const semver = require("semver");
const fse = require("fs-extra");

const templatePath = path.join(__dirname, "../../templates")
const templateVersion = require(path.join(templatePath, "package.json")).version

console.log(`================== template version: ${templateVersion} ==================`);

const fxCorePath = path.join(__dirname, "../../packages/fx-core")
const templateConfig = path.join(fxCorePath, "./src/common/templates-config.json")
const templateConfigFile = fse.readJsonSync(templateConfig)

console.log(`================== template version in fx-core configurate as ${templateConfigFile.version} ==================`)

if(!semver.prerelease(templateVersion)){
    if(!semver.intersects(templateConfigFile.version, templateVersion)){
        console.log("================== template config version is not match with template latest release version, need bump up config version ^${templateVersion} ==================")

        templateConfigFile.version = `^${templateVersion}`;
        fse.writeFileSync(templateConfig, JSON.stringify(templateConfigFile, null, 4))
    }
}