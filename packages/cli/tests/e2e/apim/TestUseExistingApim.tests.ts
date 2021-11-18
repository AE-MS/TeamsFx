// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import fs from "fs-extra";
import path from "path";
import { ApimValidator } from "../../commonlib";
import {
  execAsync,
  execAsyncWithRetry,
  getSubscriptionId,
  getTestFolder,
  getUniqueAppName,
  setSimpleAuthSkuNameToB1,
  getConfigFileName,
  cleanUp,
  cleanUpResourceGroup,
  readContext,
  setSimpleAuthSkuNameToB1Bicep,
  readContextMultiEnv,
} from "../commonUtils";
import AzureLogin from "../../../src/commonlib/azureLogin";
import GraphLogin from "../../../src/commonlib/graphLogin";
import { environmentManager, isMultiEnvEnabled } from "@microsoft/teamsfx-core";

describe("Use an existing API Management Service", function () {
  const testFolder = getTestFolder();
  const appName = getUniqueAppName();
  const subscriptionId = getSubscriptionId();
  const projectPath = path.resolve(testFolder, appName);
  const existingRGName = `${appName}existing`;
  const existingRGNameExtend = `${existingRGName}-rg`;

  it(`Import API into an existing API Management Service`, async function () {
    // new a project
    let result = await execAsync(`teamsfx new --app-name ${appName} --interactive false`, {
      cwd: testFolder,
      env: process.env,
      timeout: 0,
    });
    console.log(`Create new project. Error message: ${result.stderr}`);

    if (isMultiEnvEnabled()) {
      await setSimpleAuthSkuNameToB1Bicep(projectPath, environmentManager.getDefaultEnvName());
    } else {
      await setSimpleAuthSkuNameToB1(projectPath);
    }

    result = await execAsyncWithRetry(
      `teamsfx resource add azure-apim --subscription ${subscriptionId} --apim-resource-group ${existingRGNameExtend} --apim-service-name ${appName}-existing-apim`,
      {
        cwd: projectPath,
        env: process.env,
        timeout: 0,
      }
    );
    console.log(`Add APIM resource. Error message: ${result.stderr}`);

    await ApimValidator.init(subscriptionId, AzureLogin, GraphLogin);
    await ApimValidator.prepareApiManagementService(
      existingRGNameExtend,
      `${appName}-existing-apim`
    );

    result = await execAsyncWithRetry(`teamsfx provision`, {
      cwd: projectPath,
      env: process.env,
      timeout: 0,
    });
    console.log(`Provision. Error message: ${result.stderr}`);

    if (isMultiEnvEnabled()) {
      const provisionContext = await readContextMultiEnv(
        projectPath,
        environmentManager.getDefaultEnvName()
      );
      await ApimValidator.validateProvision(
        provisionContext,
        appName,
        existingRGNameExtend,
        `${appName}-existing-apim`
      );
    } else {
      const provisionContext = await readContext(projectPath);
      await ApimValidator.validateProvision(
        provisionContext,
        appName,
        existingRGNameExtend,
        `${appName}-existing-apim`
      );
    }

    result = await execAsyncWithRetry(
      `teamsfx deploy apim --open-api-document openapi/openapi.json --api-prefix ${appName} --api-version v1`,
      {
        cwd: projectPath,
        env: process.env,
        timeout: 0,
      },
      3,
      `teamsfx deploy apim --open-api-document openapi/openapi.json --api-version v1`
    );
    console.log(`Deploy. Error message: ${result.stderr}`);

    const deployContext = await fs.readJSON(getConfigFileName(appName));
    await ApimValidator.validateDeploy(deployContext, projectPath, appName, "v1");
  });

  after(async () => {
    if (isMultiEnvEnabled()) {
      await Promise.all([
        // clean up another resource group
        cleanUpResourceGroup(existingRGName),
        // clean up other resources
        cleanUp(appName, projectPath, true, false, true, true),
      ]);
    } else {
      await Promise.all([
        // clean up another resource group
        cleanUpResourceGroup(existingRGName),
        // clean up other resources
        cleanUp(appName, projectPath, true, false, true),
      ]);
    }
  });
});
