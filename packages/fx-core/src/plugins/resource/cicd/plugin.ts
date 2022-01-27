// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { Context } from "@microsoft/teamsfx-api/build/v2";
import { FxResult, FxCICDPluginResultFactory as ResultFactory } from "./result";
import { Logger } from "./logger";
import path from "path";
import * as fs from "fs-extra";
import { toLower } from "lodash";

export class CICDImpl {
  public async addCICDWorkflows(
    context: Context,
    projectPath: string,
    template: string,
    envName: string
  ): Promise<FxResult> {
    Logger.info("Calling addCICDWorkflows.");
    const githubWorkflowsPath = path.join(projectPath, ".github", "workflows");
    await fs.ensureDir(githubWorkflowsPath);

    // POC Mocking
    // GitHub x (CI, CD, Provision, Publish) x (Azure, SPFx)
    const targetSPFxPath = path.join(projectPath, "SPFx");
    let AzureOrSPFx = "Azure";
    if (await fs.pathExists(targetSPFxPath)) {
      AzureOrSPFx = "SPFx";
    }

    await fs.writeFile(
      path.join(githubWorkflowsPath, "README.md"),
      `template: ${template}, AzureOrSPFx: ${AzureOrSPFx}`
    );
    const ymlPath = path.join(githubWorkflowsPath, `${template}.${envName}.yml`);
    // await fs.writeFile(cdYMLPath, `AzureOrSPFx: ${AzureOrSPFx}, template: ${template}`);
    const ymlsRoot = path.join("..", "cicd");
    let sourceYmlPath = ymlsRoot;
    if (template == "ci") {
      sourceYmlPath = path.join(sourceYmlPath, "ci.yml");
    } else if (template == "publish") {
      sourceYmlPath = path.join(sourceYmlPath, "publish.yml");
    } else {
      sourceYmlPath = path.join(sourceYmlPath, `${toLower(AzureOrSPFx)}_${template}.yml`);
    }

    let rawContent = await fs.readFile(sourceYmlPath, "utf-8");
    rawContent = rawContent.replace("{{env_name}}", envName);
    if (AzureOrSPFx == "Azure") {
      rawContent = rawContent.replace(
        "{{ut_script}}",
        'echo "Set up any unit test framework you prefer (for example, mocha or jest) and update the commands accordingly."'
      );
    } else {
      rawContent = rawContent.replace("{{ut_script}}", "cd SPFx; npm run test; cd -");
    }

    if (AzureOrSPFx == "Azure") {
      rawContent = rawContent.replace("{{build_script}}", "cd tabs; npm run build; cd -");
    } else {
      rawContent = rawContent.replace("{{build_script}}", "cd SPFx; npm run build; cd -");
    }
    await fs.writeFile(ymlPath, rawContent);
    return ResultFactory.Success();
  }
}
