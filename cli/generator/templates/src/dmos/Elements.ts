import * as pcf from "@itwin/pcf";

const { PhysicalElement } = pcf.imodeljs_backend;

export const Component: pcf.ElementDMO = {
  // represents the sheet named "Component" in ./assets/sample.xlsx
  irEntity: "Component",
  // define a dynamic component 
  ecElement: {
    schema: "SampleDynamic",
    name: "Component",
    baseClass: PhysicalElement.classFullName,
  },
  modifyProps(props: any, instance: pcf.IRInstance) {
    // modify default props assigned to current EC Entity
    props.userLabel = instance.key;
  },
  categoryAttr: "CategoryName",
};

export const ComponentCategory: pcf.ElementDMO = {
  irEntity: "Category",
  ecElement: "BisCore:SpatialCategory",
};

