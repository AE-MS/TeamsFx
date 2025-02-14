// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { assert } from "chai";
import * as path from "path";
import * as fs from "fs-extra";
import * as os from "os";

import * as dotnetUtils from "../utils/dotnet";
import { isLinux, isWindows } from "../../../../src/common/deps-checker/util/system";
import {
  DotnetChecker,
  DotnetVersion,
} from "../../../../src/common/deps-checker/internal/dotnetChecker";
import { DepsChecker, DepsInfo, DepsType } from "../../../../src/common/deps-checker/depsChecker";
import { CheckerFactory } from "../../../../src/common/deps-checker/checkerFactory";
import { logger } from "../adapters/testLogger";
import { TestTelemetry } from "../adapters/testTelemetry";
import {
  assertPathEqual,
  commandExistsInPath,
  getExecutionPolicyForCurrentUser,
  setExecutionPolicyForCurrentUser,
} from "../utils/common";
import * as sinon from "sinon";
import * as process from "process";
import "mocha";

describe("DotnetChecker E2E Test - first run", async () => {
  beforeEach(async function () {
    await dotnetUtils.cleanup();
    // cleanup to make sure the environment is clean before test
  });
  afterEach(async function (t) {
    // cleanup to make sure the environment is clean
    await dotnetUtils.cleanup();
  });

  it(".NET SDK is not installed, whether globally or in home dir", async function () {
    if (await commandExistsInPath(dotnetUtils.dotnetCommand)) {
      this.skip();
    }
    const dotnetChecker = CheckerFactory.createChecker(
      DepsType.Dotnet,
      logger,
      new TestTelemetry()
    );

    const isInstalled = await dotnetChecker.isInstalled();
    assert.isFalse(isInstalled, ".NET is not installed, but isInstalled() return true");

    const depsInfo: DepsInfo = await dotnetChecker.getDepsInfo();
    assert.isNotNull(depsInfo);
    assert.isFalse(depsInfo.isLinuxSupported, "Linux should not support .NET");

    const res = await dotnetChecker.resolve();
    assert.isTrue(res.isOk() && res.value);
    await verifyPrivateInstallation(dotnetChecker);
  });

  it(".NET SDK is not installed and the user homedir contains special characters", async function () {
    if (isLinux() || (await commandExistsInPath(dotnetUtils.dotnetCommand))) {
      this.skip();
    }

    // test for space and non-ASCII characters
    const specialUserName = "Aarón García";

    const [resourceDir, cleanupCallback] = await dotnetUtils.createMockResourceDir(specialUserName);
    try {
      const dotnetChecker = CheckerFactory.createChecker(
        DepsType.Dotnet,
        logger,
        new TestTelemetry()
      ) as DotnetChecker;
      sinon.stub(dotnetChecker, "getResourceDir").returns(resourceDir);

      const res = await dotnetChecker.resolve();
      assert.isTrue(res.isOk() && res.value);
      await verifyPrivateInstallation(dotnetChecker);
    } finally {
      cleanupCallback();
    }
  });

  it(".NET SDK supported version is installed globally", async function () {
    if (
      !(await dotnetUtils.hasAnyDotnetVersions(
        dotnetUtils.dotnetCommand,
        dotnetUtils.dotnetSupportedVersions
      ))
    ) {
      this.skip();
    }

    const dotnetFullPath = await commandExistsInPath(dotnetUtils.dotnetCommand);
    assert.isNotNull(dotnetFullPath);

    const dotnetChecker = CheckerFactory.createChecker(
      DepsType.Dotnet,
      logger,
      new TestTelemetry()
    );

    assert.isTrue(await dotnetChecker.isInstalled());

    const dotnetExecPathFromConfig = await dotnetUtils.getDotnetExecPathFromConfig(
      dotnetUtils.dotnetConfigPath
    );
    assert.isNotNull(dotnetExecPathFromConfig);
    assert.isTrue(
      await dotnetUtils.hasAnyDotnetVersions(
        dotnetExecPathFromConfig!,
        dotnetUtils.dotnetSupportedVersions
      )
    );

    // test dotnet executable is from config file.
    assertPathEqual(dotnetExecPathFromConfig!, await dotnetChecker.command());
  });

  it(".NET SDK is too old", async function () {
    const has21 = await dotnetUtils.hasDotnetVersion(
      dotnetUtils.dotnetCommand,
      dotnetUtils.dotnetOldVersion
    );
    const hasSupported = await dotnetUtils.hasAnyDotnetVersions(
      dotnetUtils.dotnetCommand,
      dotnetUtils.dotnetSupportedVersions
    );
    if (!(has21 && !hasSupported)) {
      this.skip();
    }
    if (isLinux()) {
      this.skip();
    }

    assert.isTrue(await commandExistsInPath(dotnetUtils.dotnetCommand));

    const dotnetChecker = CheckerFactory.createChecker(
      DepsType.Dotnet,
      logger,
      new TestTelemetry()
    );
    const res = await dotnetChecker.resolve();

    assert.isTrue(res.isOk() && res.value);
    await verifyPrivateInstallation(dotnetChecker);
  });

  it(".NET SDK installation failure and manually install", async function () {
    if (isLinux() || (await commandExistsInPath(dotnetUtils.dotnetCommand))) {
      this.skip();
    }

    // DotnetChecker with mock dotnet-install script
    const dotnetChecker = CheckerFactory.createChecker(
      DepsType.Dotnet,
      logger,
      new TestTelemetry()
    ) as DotnetChecker;
    const correctResourceDir = dotnetChecker.getResourceDir();
    sinon.stub(dotnetChecker, "getResourceDir").returns(getErrorResourceDir());

    const res = await dotnetChecker.resolve();

    assert.isFalse(res.isOk() && res.value);
    await verifyInstallationFailed(dotnetChecker);

    // DotnetChecker with correct dotnet-install script
    sinon.stub(dotnetChecker, "getResourceDir").returns(correctResourceDir);

    // user manually install
    await dotnetUtils.withDotnet(
      dotnetChecker,
      DotnetVersion.v31,
      true,
      async (installedDotnetExecPath: string) => {
        // pre-check installed dotnet works
        assert.isTrue(
          await dotnetUtils.hasDotnetVersion(
            installedDotnetExecPath,
            dotnetUtils.dotnetInstallVersion
          )
        );

        await dotnetChecker.resolve();
        assert.isTrue(await dotnetChecker.isInstalled());
        const dotnetExecPath = await dotnetChecker.command();
        assertPathEqual(dotnetExecPath, installedDotnetExecPath);
        assert.isTrue(
          await dotnetUtils.hasDotnetVersion(dotnetExecPath, dotnetUtils.dotnetInstallVersion)
        );
      }
    );
  });

  describe("PowerShell ExecutionPolicy is default on Windows", async () => {
    if (!isWindows()) {
      return;
    }

    let originalExecutionPolicy = "Unrestricted";
    beforeEach(async function () {
      originalExecutionPolicy = await getExecutionPolicyForCurrentUser();
      await setExecutionPolicyForCurrentUser("Restricted");
    });

    afterEach(async function () {
      await setExecutionPolicyForCurrentUser(originalExecutionPolicy);
    });
    it(".NET SDK not installed and PowerShell ExecutionPolicy is default (Restricted) on Windows", async function () {
      if (await commandExistsInPath(dotnetUtils.dotnetCommand)) {
        this.skip();
      }

      const dotnetChecker = CheckerFactory.createChecker(
        DepsType.Dotnet,
        logger,
        new TestTelemetry()
      );
      const res = await dotnetChecker.resolve();

      assert.isTrue(res.isOk() && res.value);
      await verifyPrivateInstallation(dotnetChecker);
    });
  });
});

describe("DotnetChecker E2E Test - second run", () => {
  beforeEach(async function () {
    await dotnetUtils.cleanup();
    // cleanup to make sure the environment is clean before test
  });

  beforeEach(async function () {
    // cleanup to make sure the environment is clean
    await dotnetUtils.cleanup();
  });

  it("Valid dotnet.json file", async function () {
    if (await commandExistsInPath(dotnetUtils.dotnetCommand)) {
      this.skip();
    }

    const dotnetChecker = CheckerFactory.createChecker(
      DepsType.Dotnet,
      logger,
      new TestTelemetry()
    ) as DotnetChecker;
    await dotnetUtils.withDotnet(
      dotnetChecker,
      DotnetVersion.v31,
      false,
      async (installedDotnetExecPath: string) => {
        // pre-check installed dotnet works
        assert.isTrue(
          await dotnetUtils.hasDotnetVersion(
            installedDotnetExecPath,
            dotnetUtils.dotnetInstallVersion
          )
        );

        // setup config file
        await fs.mkdirp(path.resolve(dotnetUtils.dotnetConfigPath, ".."));
        await fs.writeJson(
          dotnetUtils.dotnetConfigPath,
          { dotnetExecutablePath: installedDotnetExecPath },
          {
            encoding: "utf-8",
            spaces: 4,
            EOL: os.EOL,
          }
        );

        const res = await dotnetChecker.resolve();
        const dotnetExecPath = await dotnetChecker.command();

        assert.isTrue(res.isOk() && res.value);
        assertPathEqual(dotnetExecPath, installedDotnetExecPath);
        assert.isTrue(
          await dotnetUtils.hasDotnetVersion(dotnetExecPath, dotnetUtils.dotnetInstallVersion)
        );
      }
    );
  });

  it("Invalid dotnet.json file and .NET SDK not installed", async function () {
    if (await commandExistsInPath(dotnetUtils.dotnetCommand)) {
      this.skip();
    }

    // setup config file
    const invalidPath = "/this/path/does/not/exist";
    await fs.mkdirp(path.resolve(dotnetUtils.dotnetConfigPath, ".."));
    await fs.writeJson(
      dotnetUtils.dotnetConfigPath,
      { dotnetExecutablePath: invalidPath },
      {
        encoding: "utf-8",
        spaces: 4,
        EOL: os.EOL,
      }
    );

    const dotnetChecker = CheckerFactory.createChecker(
      DepsType.Dotnet,
      logger,
      new TestTelemetry()
    );
    const res = await dotnetChecker.resolve();

    assert.isTrue(res.isOk() && res.value);
    await verifyPrivateInstallation(dotnetChecker);
  });

  it("Invalid dotnet.json file and .NET SDK installed", async function () {
    if (await commandExistsInPath(dotnetUtils.dotnetCommand)) {
      this.skip();
    }

    const dotnetChecker = CheckerFactory.createChecker(
      DepsType.Dotnet,
      logger,
      new TestTelemetry()
    ) as DotnetChecker;

    await dotnetUtils.withDotnet(
      dotnetChecker,
      DotnetVersion.v31,
      true,
      async (installedDotnetExecPath: string) => {
        const invalidPath = "/this/path/does/not/exist";
        // setup config file
        await fs.mkdirp(path.resolve(dotnetUtils.dotnetConfigPath, ".."));
        await fs.writeJson(
          dotnetUtils.dotnetConfigPath,
          { dotnetExecutablePath: invalidPath },
          {
            encoding: "utf-8",
            spaces: 4,
            EOL: os.EOL,
          }
        );

        const res = await dotnetChecker.resolve();
        const dotnetExecPath = await dotnetChecker.command();
        const dotnetExecPathFromConfig = await dotnetUtils.getDotnetExecPathFromConfig(
          dotnetUtils.dotnetConfigPath
        );

        assert.isTrue(res.isOk() && res.value);
        assertPathEqual(dotnetExecPath, installedDotnetExecPath);
        assert.isNotNull(dotnetExecPathFromConfig);
        assertPathEqual(dotnetExecPath, dotnetExecPathFromConfig!);
        assert.isTrue(
          await dotnetUtils.hasDotnetVersion(dotnetExecPath, dotnetUtils.dotnetInstallVersion)
        );
      }
    );
  });
});

async function verifyPrivateInstallation(dotnetChecker: DepsChecker) {
  assert.isTrue(await dotnetChecker.isInstalled(), ".NET installation failed");

  assert.isTrue(
    await dotnetUtils.hasDotnetVersion(
      await dotnetChecker.command(),
      dotnetUtils.dotnetInstallVersion
    )
  );

  // validate dotnet config file
  const dotnetExecPath = await dotnetUtils.getDotnetExecPathFromConfig(
    dotnetUtils.dotnetConfigPath
  );
  assert.isNotNull(dotnetExecPath);
  assert.isTrue(
    await dotnetUtils.hasDotnetVersion(dotnetExecPath!, dotnetUtils.dotnetInstallVersion)
  );
}

async function verifyInstallationFailed(dotnetChecker: DepsChecker) {
  assert.isFalse(await dotnetChecker.isInstalled());
  assert.isNull(await dotnetUtils.getDotnetExecPathFromConfig(dotnetUtils.dotnetConfigPath));
  assert.equal(await dotnetChecker.command(), dotnetUtils.dotnetCommand);
}

function getErrorResourceDir(): string {
  process.env["ENV_CHECKER_CUSTOM_SCRIPT_STDOUT"] = "mock dotnet installing";
  process.env["ENV_CHECKER_CUSTOM_SCRIPT_STDERR"] = "mock dotnet install failure";
  process.env["ENV_CHECKER_CUSTOM_SCRIPT_EXITCODE"] = "1";
  return path.resolve(__dirname, "../resource");
}
