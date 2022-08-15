/*--------------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *------------------------------------------------------------------------------------------------*/

import * as pcf from "../../pcf";

import {
    ElementOwnsChildElements,
    FolderContainsRepositories,
    FolderLink,
    LinkModel,
    LinkPartition,
    RepositoryLink,
    UrlLink,
} from "@itwin/core-backend";

export class BookmarkConnector extends pcf.PConnector {
  public async form(): Promise<void> {
    new pcf.PConnectorConfig(this, {
      connectorName: "bookmarks-connector",
      appId: "bookmarks-connector",
      appVersion: "1.0.0",
    });

    const subject = new pcf.SubjectNode(this, {
      key: "bookmarks-node"
    });

    const model = new pcf.ModelNode(this, {
        key: "links-node",
        subject: subject,
        modelClass: LinkModel,
        partitionClass: LinkPartition
    });

    new pcf.LoaderNode(this, {
      key: "parent-child-modeling-loader-node",
      model,
      loader: new pcf.JSONLoader({
        format: "json",
        entities: [
          "folder", "hyperlink", "repository"
        ],
        relationships: [
          "folder-owns-hyperlinks",
        ],
        defaultPrimaryKey: "key",
      }),
    });

    const folderDMO: pcf.ElementDMO = {
      ecElement: FolderLink.classFullName,
      irEntity: "folder",
      modifyProps: (
        connector: pcf.PConnector,
        props: { [property: string]: unknown}, instance: pcf.IRInstance
      ): void => {
        props.description = instance.get("description");
      },
    };

    const hyperlinkDMO: pcf.ElementDMO = {
      ecElement: UrlLink.classFullName,
      irEntity: "hyperlink",
      modifyProps: (
        connector: pcf.PConnector,
        props: { [property: string]: unknown}, instance: pcf.IRInstance
      ): void => {
        props.userLabel = instance.get("userLabel");
        props.description = instance.get("description");
        props.url = instance.get("url");
      },
    };

    const repositoryDMO: pcf.ElementDMO = {
      ecElement: RepositoryLink.classFullName,
      irEntity: "repository",
      modifyProps: (
        connector: pcf.PConnector,
        props: { [property: string]: unknown}, instance: pcf.IRInstance
      ): void => {
        props.userLabel = instance.get("userLabel");
      },
      parentAttr: "parent",
    };

    const folderOwnsHyperlinkDMO: pcf.RelatedElementDMO = {
      irEntity: "folder-owns-hyperlinks",
      ecRelationship: ElementOwnsChildElements.classFullName,
      ecProperty: "parent",
      fromAttr: "from",
      toAttr: "to",
      fromType: "IREntity",
      toType: "IREntity",
    };

    const folder = new pcf.ElementNode(this, {
      model,
      key: "folder-node",
      dmo: folderDMO,
    });

    new pcf.ElementNode(this, {
      model,
      parent: {
        parent: folder,
        relationship: FolderContainsRepositories.classFullName,
      },
      key: "repository-node",
      dmo: repositoryDMO,
    });

    const hyperlink = new pcf.ElementNode(this, {
      model,
      key: "hyperlink",
      dmo: hyperlinkDMO,
    });

    new pcf.RelatedElementNode(this, {
      subject,
      source: folder,
      target: hyperlink,
      key: "folder-owns-hyperlinks-node",
      dmo: folderOwnsHyperlinkDMO,
    });
  }
}

export async function getConnectorInstance(): Promise<BookmarkConnector> {
  const connector = new BookmarkConnector();
  await connector.form();
  return connector;
}
