
%%{init: {'theme':'base'}}%%

%% Overall Architecture %%
graph LR
    A[(External Data X)] -->|Loader for X| B[(IR Model)]
    B --> C((DMOs))
    B --> D((Nodes))
    subgraph Defined by Users
    C --> E(Connector for X)
    D --> E
    end
    E --> F(PCF Core)
    F --> G[(iModel)]

%% IR Model %%
flowchart TD
    IRModel[(IR Model)] --> IREntity
    IRModel --> IRRelationship[IR Relationship]
    IREntity[IR Entity] --> IRInstance1[IR Instance]
    IRRelationship[IR Relationship] --> IRInstance2[IR Instance]

%% Loader %%
flowchart LR
    A[(External Data X)] -->|Loader for X| B[(IR Model)]

%% DMO %%
flowchart LR
    DMO ---|maps to| A[An EC Element/Relationship class in iModel]
    DMO ---|maps from| B[An IR Entity/Relationship class in IR Model]

%% Subject Tree %%
flowchart BT
    ModelNode1[ModelNode A] --> SubjectNode[SubjectNode A]
    ModelNode2[ModelNode B] --> SubjectNode
    RelationshipNode[ModelNode B] --> SubjectNode
    ElementNode1[ElementNode A] --> ModelNode1
    ElementNode2[ElementNode B] --> ModelNode2
    DMO1[DMO A]:::DMOClass --> ElementNode1
    DMO2[DMO B]:::DMOClass --> ElementNode2
    ElementNode1[ElementNode A] --> RelationshipNode[RelationshipNode A]
    ElementNode2[ElementNode B] --> RelationshipNode
    DMO3[DMO C]:::DMOClass ---> RelationshipNode
    classDef DMOClass fill:#f96;
