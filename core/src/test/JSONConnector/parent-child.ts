/*--------------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *------------------------------------------------------------------------------------------------*/

import * as pcf from "../../pcf";

import { ElementOwnsChildElements, FolderContainsRepositories, FolderLink, LinkModel, LinkPartition, RepositoryLink, UrlLink } from "@itwin/core-backend";

/*
 *                                o - repository model
 *                               / \
 *                     folder - o   o - repository (pcf's loader)
 *                             /|\
 * ElementOwnsChildElements - / | \ - FolderContainsRepositories
 *              hyperlinks - o  o  o - modeled repository
 *                             /   |
 *                  repository     o - submodel
 *                                / \
 *                               o   o - more hyperlinks
 *                                  / \
 *                                 o   o - children hyperlinks in submodel
 */

export class BookmarkConnector extends pcf.PConnector {
  public async form(): Promise<void> {
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

    const hyperlinkDMO = (label: string): pcf.ElementWithParentDMO => ({
      ecElement: UrlLink.classFullName,
      irEntity: label,
      modifyProps: (
        connector: pcf.PConnector,
        props: { [property: string]: unknown}, instance: pcf.IRInstance
      ): void => {
        props.userLabel = instance.get("userLabel");
        props.description = instance.get("description");
        props.url = instance.get("url");
      },
      parentAttr: "parent",
    });

    const repositoryDMO = (label: string): pcf.ElementWithParentDMO => ({
      ecElement: RepositoryLink.classFullName,
      irEntity: label,
      modifyProps: (
        connector: pcf.PConnector,
        props: { [property: string]: unknown}, instance: pcf.IRInstance
      ): void => {
        props.userLabel = instance.get("userLabel");
        props.description = instance.get("description");
        props.url = instance.get("url");
      },
      parentAttr: "parent",
    });

    const folderOwnsHyperlinkDMO: pcf.RelatedElementDMO = {
      irEntity: "folder-owns-hyperlinks",
      ecRelationship: ElementOwnsChildElements.classFullName,
      ecProperty: "parent",
      fromAttr: "from",
      toAttr: "to",
      fromType: "IREntity",
      toType: "IREntity",
    };

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
          "folder", "repository",
          "hyperlink",
          "modeled-repository",
          "child-of-modeled-repository",
          "child-of-child-of-modeled-repository"
        ],
        relationships: [
          "folder-owns-hyperlinks",
        ],
        defaultPrimaryKey: "key",
      }),
    });

    const folder = new pcf.ElementNode(this, {
      model,
      key: "folder-node",
      dmo: folderDMO,
    });

    new pcf.ElementNode(this, {
      parent: {
        parent: folder,
        relationship: FolderContainsRepositories.classFullName,
      },
      key: "repository-node",
      dmo: repositoryDMO("repository"),
    });

    // Note that we're using the hyperlink DMO, which specifies parentAttr. But it's not in the JSON
    // of the IR instances of the IR entity 'hyperlink'. So the property is undefined, which is a
    // no-op in the iTwin API.
    const hyperlink = new pcf.ElementNode(this, {
      model,
      key: "hyperlink-node",
      dmo: hyperlinkDMO("hyperlink"),
    });

    const modeledRepository = new pcf.ModeledElementNode(this, {
      subject,
      parent: {
        parent: folder,
        relationship: FolderContainsRepositories.classFullName,
      },
      modelClass: LinkModel,
      key: "modeled-repository-node",
      dmo: repositoryDMO("modeled-repository"),
    });

    const childOfModeledRepository = new pcf.ElementNode(this, {
      parent: modeledRepository,
      key: "child-of-modeled-repository-node",
      dmo: hyperlinkDMO("child-of-modeled-repository"),
    });

    new pcf.ElementNode(this, {
      parent: {
        parent: childOfModeledRepository,
        relationship: ElementOwnsChildElements.classFullName,
      },
      key: "child-of-child-of-modeled-repository-node",
      dmo: hyperlinkDMO("child-of-child-of-modeled-repository")
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
