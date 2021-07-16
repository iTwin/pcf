/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { ProcessDetector } from "@bentley/bentleyjs-core";
import * as path from "path";
import * as os from "os";

export default class KnownTestLocations {

  public static get libDir(): string {
    return path.join(__dirname, "..", "..", "lib");
  }

  public static get testDir(): string {
    return path.join(KnownTestLocations.libDir, "test");
  }

  public static get unitTestDir(): string {
    return path.join(KnownTestLocations.testDir, "unit");
  }

  public static get integrationTestDir(): string {
    return path.join(KnownTestLocations.testDir, "integration");
  }

  public static get testAssetsDir(): string {
    return path.join(KnownTestLocations.testDir, "assets");
  }

  public static get testOutputDir(): string {
    if (ProcessDetector.isMobileAppBackend)
      return path.join(os.tmpdir(), "output");
    return path.join(KnownTestLocations.testDir, "output");
  }

  public static get JSONConnectorDir(): string {
    return path.join(KnownTestLocations.testDir, "JSONConnector");
  }
}
