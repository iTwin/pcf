/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { QueryToCount } from "../Util";

const TestResults: {[sourceFile: string]: QueryToCount} = {
  "v1.json": { // from empty
    // Subject
    "select * from BisCore:Subject": 2,
    "select * from BisCore:Subject where codeValue='Subject1'": 1,
    // RepoLink
    "select * from BisCore:RepositoryLink where codeValue='json-loader-1'": 1,
    "select * from BisCore:ExternalSourceAspect where identifier='json-loader-1'": 1,
    // Partition
    "select * from BisCore:DefinitionPartition": 2,
    "select * from BisCore:GroupInformationPartition": 1,
    "select * from BisCore:PhysicalPartition": 2,
    // Model
    "select * from BisCore:DefinitionModel": 3,
    "select * from BisCore:PhysicalModel": 2,
    "select * from BisCore:GroupInformationModel": 1,
    "select * from BisCore:LinkModel": 6,
    // Element
    "select * from BisCore:SpatialCategory": 2,
    "select * from bis:SubCategory where Description is not null": 1,
    "select * from TestSchema:ExtPhysicalType": 2,
    "select * from TestSchema:ExtPhysicalType where UserLabel='mock_user_label'": 2,
    "select * from TestSchema:ExtPhysicalElement": 4,
    "select * from TestSchema:ExtPhysicalElement where RoomNumber='1'": 1,
    "select * from TestSchema:ExtPhysicalElement where BuildingNumber='1'": 1,
    "select * from TestSchema:ExtGroupInformationElement": 2,
    // Relationship
    "select * from TestSchema:ExtElementGroupsMembers": 1,
    "select * from TestSchema:ExtElementRefersToElements": 1,
    "select * from TestSchema:ExtElementRefersToExistingElements": 0,
    "select * from TestSchema:ExtPhysicalElementAssemblesElements": 2,
    "select categories.ECInstanceId from bis:ElementOwnsChildElements as relationships inner join bis:SpatialCategory as categories on relationships.SourceECInstanceId = categories.ECInstanceId": 3,
    // Domain Class
    "select * from BuildingSpatial:Space": 1,
    "select * from BuildingSpatial:Space where FootprintArea=10": 1,
    // Nested models
    "select * from bis:RepositoryLink where UserLabel in ('reference documents', 'large clients', 'backlog', 'pro bono projects')": 4,
    "select * from bis:UrlLink where UserLabel in ('high-rise floor plans', 'steeple drawing', 'interior design sketches')": 3,
    "select * from bis:LinkModel as models inner join bis:RepositoryLink as repositories on repositories.Model.id = models.ECInstanceId where repositories.UserLabel like '%reference%'": 1,
    "select distinct models.ECInstanceId from bis:LinkModel as models inner join bis:RepositoryLink as repositories on repositories.Model.id = models.ECInstanceId where repositories.UserLabel in ('large clients', 'backlog', 'pro bono projects')": 1,
    "select distinct models.ECInstanceId from bis:LinkModel as models inner join bis:UrlLink as links on links.Model.id = models.ECInstanceId where links.UserLabel in ('high-rise floor plans', 'steeple drawing', 'interior design sketches')": 2,
  },
  "v2.json": {
    // Subject
    "select * from BisCore:Subject": 2,
    "select * from BisCore:Subject where codeValue='Subject1'": 1,
    // RepoLink
    "select * from BisCore:RepositoryLink where codeValue='json-loader-1'": 1,
    "select * from BisCore:ExternalSourceAspect where identifier='json-loader-1'": 1,
    // Partition
    "select * from BisCore:DefinitionPartition": 2,
    "select * from BisCore:GroupInformationPartition": 1,
    "select * from BisCore:PhysicalPartition": 2,
    // Model
    "select * from BisCore:DefinitionModel": 3,
    "select * from BisCore:PhysicalModel": 2,
    "select * from BisCore:GroupInformationModel": 1,
    "select * from BisCore:LinkModel": 5,                             // -1 (from v1)
    // Element
    "select * from BisCore:SpatialCategory": 1,                       // -1 (from v1)
    "select * from BisCore:SubCategory where Description is not null": 1,
    "select * from TestSchema:ExtPhysicalType": 3,                    // +1 (from v1)
    "select * from TestSchema:ExtPhysicalType where UserLabel='new_mock_user_label'": 3, // attribute update (from v1)
    "select * from TestSchema:ExtPhysicalElement": 3,                 // -2+1 (from v1)
    "select * from TestSchema:ExtGroupInformationElement": 1,         // -1 (from v1)
    "select * from bis:SubCategory as subcategories inner join bis:Category as categories on subcategories.Parent.id = categories.ECInstanceId where subcategories.Description like '%moved%' and categories.CodeValue = 'ExtSpatialCategory-1'": 1,
    // Element Aspect
    "select * from TestSchema:ExtElementAspectA": 1,
    "select * from TestSchema:ExtElementAspectB": 1,
    "select * from TestSchema:ExtElementAspectA where Name='a-name'": 1,
    "select * from BisCore:ExternalSourceAspect where identifier='ExtElementAspectA-1' and Element.id in (0x20000000010, 0x20) ": 1, // provenance of ExtElementAspect
    "select * from bis:ChannelRootAspect as aspects inner join TestSchema:ExtPhysicalElement as elements on aspects.Element.id = elements.ECInstanceId where elements.CodeValue in ('ExtPhysicalElement-1', 'ExtPhysicalElement-5')": 2,
    "select * from bis:ExternalSourceAspect as metas inner join TestSchema:ExtPhysicalElement as elements on metas.Element.id = elements.ECInstanceId where metas.Identifier = 'ElementAspectC-1' and elements.CodeValue = 'ExtPhysicalElement-1'": 1,
    "select * from bis:ExternalSourceAspect as metas inner join TestSchema:ExtPhysicalElement as elements on metas.Element.id = elements.ECInstanceId where metas.Identifier = 'ElementAspectC-2' and elements.CodeValue = 'ExtPhysicalElement-5'": 1,
    // Relationship
    "select * from TestSchema:ExtElementGroupsMembers": 0,            // -1 (from v1)
    "select * from TestSchema:ExtElementRefersToElements": 2,         // +1 (from v1)
    "select * from TestSchema:ExtElementRefersToExistingElements": 1, // +1 (from v1)
    "select * from TestSchema:ExtExistingElementRefersToElements": 1,
    "select * from TestSchema:ExtPhysicalElementAssemblesElements": 1,
    "select categories.ECInstanceId from bis:ElementOwnsChildElements as relationships inner join bis:SpatialCategory as categories on relationships.SourceECInstanceId = categories.ECInstanceId": 2, // +1 default subcategory
    // Domain Class
    "select * from BuildingSpatial:Space": 1,
    // Nested models, pro bono projects deleted and sushi project added to backlog
    "select * from bis:RepositoryLink where UserLabel in ('pro bono projects')": 0,
    "select * from bis:RepositoryLink where UserLabel in ('reference documents', 'large clients', 'backlog')": 3,
    "select * from bis:UrlLink where UserLabel in ('steeple drawing', 'interior design sketches')": 0,
    "select * from bis:UrlLink where UserLabel in ('high-rise floor plans', 'sushi restaurant flooring')": 2,
    "select * from bis:LinkModel as models inner join bis:RepositoryLink as repositories on repositories.Model.id = models.ECInstanceId where repositories.UserLabel like '%reference%'": 1,
    "select distinct models.ECInstanceId from bis:LinkModel as models inner join bis:RepositoryLink as repositories on repositories.Model.id = models.ECInstanceId where repositories.UserLabel in ('large clients', 'backlog')": 1,
    "select distinct models.ECInstanceId from bis:LinkModel as models inner join bis:UrlLink as links on links.Model.id = models.ECInstanceId where links.UserLabel in ('high-rise floor plans', 'sushi restaurant flooring')": 2,
  },
  "v3.json": { // add a new element with the same code as a previously deleted element.
    // Subject
    "select * from BisCore:Subject": 2,
    "select * from TestSchema:ExtGroupInformationElement": 2, // +1 (from v2)
    // Element Aspect
    "select * from TestSchema:ExtElementAspectA": 1,
    "select * from TestSchema:ExtElementAspectB": 1,
    "select * from TestSchema:ExtElementAspectA where Name='a-new-name'": 1, // attribute update
    "select * from BisCore:ExternalSourceAspect where Identifier='ExtElementAspectA-1'": 1, // provenance update
    "select * from BisCore:ExternalSourceAspect where Identifier='ExtElementAspectA-1' and element.id in (0x20000000010, 0x20)": 1, // provenance update
    "select * from bis:ChannelRootAspect": 1,
    "select * from bis:ChannelRootAspect as aspects inner join TestSchema:ExtPhysicalElement as elements on aspects.Element.id = elements.ECInstanceId where elements.CodeValue = 'ExtPhysicalElement-2'": 1,
    "select * from bis:ExternalSourceAspect where Identifier = 'ElementAspectC-1'": 1,
    "select * from bis:ExternalSourceAspect as metas inner join TestSchema:ExtPhysicalElement as elements on metas.Element.id = elements.ECInstanceId where metas.Identifier = 'ElementAspectC-1' and elements.CodeValue = 'ExtPhysicalElement-2'": 1,
    // Nested models, everything deleted; 1 default, 1 for the loader
    "select * from bis:LinkModel": 2,
  },
  "v4.json": {
    // Element Aspect
    "select * from TestSchema:ExtElementAspectA": 0, // -1 (from v3)
    "select * from TestSchema:ExtElementAspectB": 0, // -1 (from v3)
    "select * from bis:ChannelRootAspect": 0,        // -1 (from v3)
  },
  "v5.json": { // introduce a new Subject
    "select * from BisCore:Subject": 3,
    "select * from BisCore:Subject where codeValue='Subject2'": 1,
    "select * from BisCore:RepositoryLink": 2,
    "select * from BisCore:RepositoryLink where codeValue='api-loader-1'": 1,
    // Element
    "select * from TestSchema:ExtGroupInformationElement": 2, // unchanged (from v3)
  },
  "parent-child.json": {
    "select * from bis:FolderLink": 1,
    // The child repositories.
    "select * from bis:RepositoryLink where UserLabel = 'somewhere over the rainbow'": 1,
    "select * from bis:RepositoryLink where UserLabel = 'Reddit'": 1,
    "select * from bis:FolderContainsRepositories": 2,
    // The child URLs.
    "select * from bis:UrlLink where UserLabel in ('National Geographic', 'The New York Times')": 2,
    "select * from only bis:ElementOwnsChildElements as relationships inner join bis:FolderLink as folders on relationships.SourceECInstanceId = folders.ECInstanceId": 2,
    // The submodel.
    "select * from bis:UrlLink where UserLabel in ('Cozy Places', 'Aww', 'Pics')": 3,
    // The Reddit repository is a modeled element that contains 3 subreddits and 2 posts; the outer model does not contain them.
    "select * from bis:ModelContainsElements as relationships inner join bis:UrlLink as links on relationships.TargetECInstanceId = links.ECInstanceId where links.Url like '%reddit.com/r%'": 5,
    "select * from bis:ModelModelsElement as relationships inner join bis:RepositoryLink as links on relationships.TargetECInstanceId = links.ECInstanceId": 1,
    // There's a default link model 0xe. I don't know why. Then 1 is mine, and 1 for the loader.
    "select * from bis:LinkModel": 3,
    "select * from bis:ModelOwnsSubModel as relationships inner join bis:LinkModel as models on relationships.TargetECInstanceId = models.ECInstanceId": 3,
    // The children of the children of the modeled repository.
    "select * from bis:UrlLink where Description like '%lakeside cabin%'": 1,
    "select * from bis:UrlLink where Description like '%reading corner%'": 1,
    "select * from only bis:ElementOwnsChildElements as relationships inner join only bis:UrlLink as links on relationships.SourceECInstanceId = links.ECInstanceId": 2,
  }
};

export default TestResults;
