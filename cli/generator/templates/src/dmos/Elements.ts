import * as common from "@bentley/imodeljs-common";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";

export const Component: pcf.ElementDMO = {
  entity: "Component",
  classFullName: "COBieDynamic:Component",
  classProps: {
    name: "Component",
    baseClass: bk.PhysicalElement.classFullName,
  },
  modifyProps(props: any, instance: pcf.IRInstance) {
    props.userLabel = "COBie Component";
  },
};
