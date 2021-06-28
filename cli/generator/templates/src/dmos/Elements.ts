import * as common from "@bentley/imodeljs-common";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";

export const Component: pcf.ElementDMO = {
  // represents the sheet named "Component" in ./assets/sample.xlsx
  irEntity: "Component",
  // represents the full class name of a dynamic EC class defined by classProps
  ecEntity: "SampleDynamic:Component",
  // define a dynamic component 
  classProps: {
    name: "Component",
    baseClass: bk.PhysicalElement.classFullName,
  },
  modifyProps(props: any, instance: pcf.IRInstance) {
    // modify default props assigned to current EC Entity
    props.userLabel = instance.key;
  },
};

export const ComponentCategory: pcf.ElementDMO = {
  irEntity: "Category",
  ecEntity: "BisCore:SpatialCategory",
};

