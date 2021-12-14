/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { QueryToCount } from "../Util";

const TestResults: {[fileName: string]: QueryToCount} = {
  "v1.json": { // from empty
    // Subject
    "select * from BisCore:Subject": 2,
    "select * from BisCore:Subject where codeValue=\'Subject1\'": 1,
    // RepoLink
    "select * from BisCore:RepositoryLink": 1,
    "select * from BisCore:RepositoryLink where codeValue=\'json-loader-1\'": 1,
    "select * from BisCore:ExternalSourceAspect where identifier=\'json-loader-1\'": 1,
    // Partition
    "select * from BisCore:DefinitionPartition": 2,
    "select * from BisCore:GroupInformationPartition": 1,
    "select * from BisCore:PhysicalPartition": 2,
    // Model
    "select * from BisCore:DefinitionModel": 3,
    "select * from BisCore:PhysicalModel": 2,
    "select * from BisCore:GroupInformationModel": 1,
    "select * from BisCore:LinkModel": 2,
    // Element
    "select * from BisCore:SpatialCategory": 2,
    "select * from TestSchema:ExtPhysicalType": 2,
    "select * from TestSchema:ExtPhysicalType where UserLabel=\'mock_user_label\'": 2,
    "select * from TestSchema:ExtPhysicalElement": 4,
    "select * from TestSchema:ExtPhysicalElement where RoomNumber=\'1\'": 1,
    "select * from TestSchema:ExtPhysicalElement where BuildingNumber=\'1\'": 1,
    "select * from TestSchema:ExtGroupInformationElement": 2,
    // Relationship
    "select * from TestSchema:ExtElementGroupsMembers": 1,
    "select * from TestSchema:ExtElementRefersToElements": 1,
    "select * from TestSchema:ExtElementRefersToExistingElements": 0,
    "select * from TestSchema:ExtPhysicalElementAssemblesElements": 2,
    // Domain Class
    "select * from BuildingSpatial:Space": 1,
    "select * from BuildingSpatial:Space where FootprintArea=10": 1,
  },
  "v2.json": {
    // Subject
    "select * from BisCore:Subject": 2,
    "select * from BisCore:Subject where codeValue=\'Subject1\'": 1,
    // RepoLink
    "select * from BisCore:RepositoryLink": 1,
    // Partition
    "select * from BisCore:DefinitionPartition": 2,
    "select * from BisCore:GroupInformationPartition": 1,
    "select * from BisCore:PhysicalPartition": 2,
    // Model
    "select * from BisCore:DefinitionModel": 3,
    "select * from BisCore:PhysicalModel": 2,
    "select * from BisCore:GroupInformationModel": 1,
    "select * from BisCore:LinkModel": 2,
    // Element
    "select * from BisCore:SpatialCategory": 1,                       // -1 (from v1)
    "select * from TestSchema:ExtPhysicalType": 3,                    // +1 (from v1)
    "select * from TestSchema:ExtPhysicalType where UserLabel=\'new_mock_user_label\'": 3, // attribute update (from v1)
    "select * from TestSchema:ExtPhysicalElement": 3,                 // -2+1 (from v1)
    "select * from TestSchema:ExtGroupInformationElement": 1,         // -1 (from v1)
    "select * from TestSchema:ExtPhysicalElementAssemblesElements": 1,
    // Element Aspect
    "select * from TestSchema:ExtElementAspect": 1,
    "select * from TestSchema:ExtElementAspect where Name=\'aspect-a\'": 1,
    "select * from BisCore:ExternalSourceAspect where identifier=\'ExtElementAspect-1\'": 1,
    // Relationship
    "select * from TestSchema:ExtElementGroupsMembers": 0,            // -1 (from v1)
    "select * from TestSchema:ExtElementRefersToElements": 2,         // +1 (from v1)
    "select * from TestSchema:ExtElementRefersToExistingElements": 1, // +1 (from v1)
    "select * from TestSchema:ExtExistingElementRefersToElements": 1,
    // Domain Class
    "select * from BuildingSpatial:Space": 1,
  },
  "v3.json": { // add a new element with the same code as a previously deleted element.
    "select * from TestSchema:ExtGroupInformationElement": 2, // +1 (from v2)
    // Element Aspect
    "select * from TestSchema:ExtElementAspect": 1,
    "select * from TestSchema:ExtElementAspect where Name=\'aspect-b\'": 1,
  },
  "v4.json": {
    "select * from BisCore:Subject": 3,
    "select * from BisCore:Subject where codeValue=\'Subject2\'": 1,
    "select * from BisCore:RepositoryLink": 2,
    "select * from BisCore:RepositoryLink where codeValue=\'api-loader-1\'": 1,
    // Element Aspect
    "select * from TestSchema:ExtElementAspect": 0,
  }
};

export default TestResults;

